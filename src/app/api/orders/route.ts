import {
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { randomUUID } from "node:crypto";
import {
  isValidReceiptEmail,
  normalizeReceiptEmail,
  normalizeReceiptWhatsapp,
  isValidIndonesianWhatsapp,
  validateGuestReceiptContact,
} from "@/lib/customer-contact";
import { validateGameAccountTarget } from "@/lib/game-account";
import {
  getPointsSummary,
  maxRedeemablePointsForSubtotal,
  pointsToIdr,
  reserveOrderPoints,
  restoreOrderPointsRedemption,
  validateRequestedPoints,
} from "@/lib/loyalty";
import { createMidtransSnapTransaction, isMidtransSandboxConfigured } from "@/lib/midtrans/client";
import { reservePromotionForOrder, syncPromotionLifecycle } from "@/lib/promotion-service";
import { getPublicOrder } from "@/lib/order-service";
import {
  createOrderAccessCookie,
  createOrderAccessCredential,
} from "@/lib/order-access";
import { calculatePricing } from "@/lib/pricing";
import { getPricingContext } from "@/lib/pricing-repository";
import { isSupabaseConfigured, supabaseInsert, supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CreateOrderBody = {
  gameId?: string;
  packageId?: string;
  paymentId?: string;
  targetUserId?: string;
  targetServerId?: string;
  promoCode?: string;
  referralCode?: string;
  receiptEmail?: string;
  receiptWhatsapp?: string;
  pointsToRedeem?: number;
};

type GameAccountRow = {
  id: string;
  name: string;
  short_name: string;
  requires_server: boolean;
};

const MIDTRANS_PAYMENT_MAP: Record<string, string[]> = {
  qris: ["gopay", "shopeepay", "other_qris"],
  ewallet: ["gopay", "shopeepay", "dana", "ovo"],
  va: ["bank_transfer"],
};

function createOrderId(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  return `NBH-${date}-${suffix}`;
}

function clean(value?: string, maxLength = 80) {
  return value?.trim().slice(0, maxLength) ?? "";
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Database Nambah belum dikonfigurasi untuk membuat order." },
      { status: 503 },
    );
  }

  if (!isMidtransSandboxConfigured()) {
    return Response.json(
      { error: "Midtrans Sandbox belum dikonfigurasi." },
      { status: 503 },
    );
  }

  let body: CreateOrderBody;
  try {
    body = (await request.json()) as CreateOrderBody;
  } catch {
    return Response.json({ error: "Request order tidak valid." }, { status: 400 });
  }

  const targetUserId = clean(body.targetUserId, 64);
  const targetServerId = clean(body.targetServerId, 64);
  const auth = await resolveNambahAuth(request);

  let receiptEmail = "";
  let receiptWhatsapp = "";
  if (auth.user) {
    receiptEmail = normalizeReceiptEmail(auth.user.email);
    if (!receiptEmail || !isValidReceiptEmail(receiptEmail)) {
      return Response.json(
        { error: "Email akun Nambah tidak tersedia untuk receipt." },
        { status: 409 },
      );
    }

    try {
      const [profile] = await supabaseSelect<{
        whatsapp: string | null;
      }>("customer_profiles", {
        select: "whatsapp",
        filters: { user_id: `eq.${auth.user.id}` },
        limit: 1,
      });
      const normalizedWhatsapp = normalizeReceiptWhatsapp(profile?.whatsapp);
      if (
        normalizedWhatsapp &&
        isValidIndonesianWhatsapp(normalizedWhatsapp)
      ) {
        receiptWhatsapp = normalizedWhatsapp;
      }
    } catch (error) {
      console.warn("Customer profile receipt contact unavailable", error);
    }
  } else {
    const contact = validateGuestReceiptContact(
      body.receiptEmail,
      body.receiptWhatsapp,
    );
    if (!contact.ok) {
      return Response.json({ error: contact.error }, { status: 400 });
    }
    receiptEmail = contact.email;
    receiptWhatsapp = contact.whatsapp;
  }

  const pricingContext = await getPricingContext({
    gameId: body.gameId,
    packageId: body.packageId,
    paymentId: body.paymentId,
    promoCode: body.promoCode,
    referralCode: body.referralCode,
  });

  if (!pricingContext.ok) {
    return Response.json({ error: pricingContext.error }, { status: pricingContext.status });
  }

  if (pricingContext.context.source !== "supabase") {
    return Response.json(
      { error: "Order pembayaran hanya dapat dibuat dari catalog database." },
      { status: 503 },
    );
  }

  const {
    game,
    selectedPackage,
    paymentMethod,
    promotion,
    referral,
    minimumNambahProfit,
  } = pricingContext.context;

  const [gameConfig] = await supabaseSelect<GameAccountRow>("games", {
    select: "id,name,short_name,requires_server",
    filters: { id: `eq.${game.id}`, active: "eq.true" },
    limit: 1,
  });

  if (!gameConfig) {
    return Response.json({ error: "Konfigurasi akun produk tidak ditemukan." }, { status: 409 });
  }

  const account = validateGameAccountTarget(
    {
      id: gameConfig.id,
      name: gameConfig.name,
      shortName: gameConfig.short_name,
      requiresServer: gameConfig.requires_server,
    },
    targetUserId,
    targetServerId,
  );

  if (!account.ok) {
    return Response.json({ error: account.error }, { status: 400 });
  }

  const enabledPayments = MIDTRANS_PAYMENT_MAP[paymentMethod.id];
  if (!enabledPayments) {
    return Response.json(
      { error: "Metode pembayaran belum didukung Midtrans Sandbox." },
      { status: 400 },
    );
  }

  const pointsRequest = validateRequestedPoints(body.pointsToRedeem);
  if (!pointsRequest.ok) {
    return Response.json({ error: pointsRequest.error }, { status: 400 });
  }

  const basePricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion,
    referral,
    loyaltyEligible: Boolean(auth.user),
    minimumNambahProfit,
  });

  if (!basePricing.safeToCheckout) {
    return Response.json(
      { error: basePricing.rejectionReason ?? "Harga belum aman untuk checkout." },
      { status: 409 },
    );
  }

  let pointsDiscount = 0;
  if (pointsRequest.points > 0) {
    if (!auth.user) {
      return Response.json(
        { error: "Login diperlukan untuk menggunakan Nambah Points." },
        { status: 401 },
      );
    }

    const points = await getPointsSummary(auth.user.id);
    if (points.available < pointsRequest.points) {
      return Response.json(
        { error: `Nambah Points tersedia hanya ${points.available} points.` },
        { status: 409 },
      );
    }

    const subtotalBeforePoints = Math.max(
      0,
      basePricing.sellingPrice -
        basePricing.promotionDiscount -
        basePricing.referralDiscount,
    );
    const maxPoints = maxRedeemablePointsForSubtotal(subtotalBeforePoints);
    if (pointsRequest.points > maxPoints) {
      return Response.json(
        {
          error:
            maxPoints > 0
              ? `Maksimum penggunaan untuk transaksi ini adalah ${maxPoints} Nambah Points.`
              : "Nambah Points belum dapat digunakan pada transaksi ini.",
        },
        { status: 409 },
      );
    }

    pointsDiscount = pointsToIdr(pointsRequest.points);
  }

  const pricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion,
    referral,
    pointsDiscount,
    loyaltyEligible: Boolean(auth.user),
    minimumNambahProfit,
  });

  if (!pricing.safeToCheckout) {
    return Response.json(
      { error: pricing.rejectionReason ?? "Harga belum aman untuk checkout." },
      { status: 409 },
    );
  }

  if (!Number.isInteger(pricing.finalPrice) || pricing.finalPrice <= 0) {
    return Response.json({ error: "Total pembayaran tidak valid." }, { status: 409 });
  }

  const orderId = createOrderId();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const access = createOrderAccessCredential();

  try {
    await supabaseInsert("orders", {
      id: orderId,
      customer_user_id: auth.user?.id ?? null,
      receipt_email: receiptEmail,
      receipt_whatsapp: receiptWhatsapp || null,
      game_id: game.id,
      product_id: selectedPackage.id,
      payment_method_id: paymentMethod.id,
      target_user_id: account.userId,
      target_server_id: account.serverId ?? null,
      promotion_code: pricing.promoCode,
      affiliate_code: pricing.referralCode,
      supplier_id: "digiflazz",
      status: "pending_payment",
      reference_price: pricing.referencePrice,
      selling_price: pricing.sellingPrice,
      supplier_cost: pricing.supplierCost,
      customer_payment_fee: pricing.customerPaymentFee,
      merchant_payment_cost: pricing.merchantPaymentCost,
      promotion_discount: pricing.promotionDiscount,
      referral_discount: pricing.referralDiscount,
      points_redeemed: pricing.pointsRedeemed,
      points_discount: pricing.pointsDiscount,
      points_earned: pricing.pointsEarned,
      final_price: pricing.finalPrice,
      net_profit_before_affiliate: pricing.netProfitBeforeAffiliate,
      affiliate_rate: pricing.affiliateRate,
      affiliate_commission: pricing.affiliateCommission,
      nambah_profit: pricing.nambahProfit,
      access_token_hash: access.tokenHash,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
      status_changed_at: now,
      terminal_at: null,
    });

    if (pricing.pointsRedeemed > 0 && auth.user) {
      try {
        await reserveOrderPoints(orderId, auth.user.id);
      } catch (error) {
        await supabaseUpdate(
          "orders",
          {
            status: "cancelled",
            status_changed_at: new Date().toISOString(),
            terminal_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { filters: { id: `eq.${orderId}` } },
        );
        throw new Error(
          error instanceof Error
            ? `Nambah Points gagal direservasi: ${error.message}`
            : "Nambah Points gagal direservasi.",
        );
      }
    }

    if (pricing.promoCode) {
      try {
        await reservePromotionForOrder(orderId);
      } catch (error) {
        await Promise.all([
          pricing.pointsRedeemed > 0
            ? restoreOrderPointsRedemption(orderId).catch(() => undefined)
            : Promise.resolve(),
          supabaseUpdate(
            "orders",
            {
              status: "cancelled",
              status_changed_at: new Date().toISOString(),
              terminal_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { filters: { id: `eq.${orderId}` } },
          ),
        ]);
        throw new Error(
          error instanceof Error
            ? `Promo gagal direservasi: ${error.message}`
            : "Promo gagal direservasi.",
        );
      }
    }

    await supabaseInsert("payments", {
      order_id: orderId,
      provider: "midtrans",
      provider_transaction_id: null,
      status: "pending",
      amount: pricing.finalPrice,
      raw_status: "snap_creating",
      created_at: now,
      updated_at: now,
    });

    let snap;
    try {
      snap = await createMidtransSnapTransaction({
        orderId,
        grossAmount: pricing.finalPrice,
        itemId: selectedPackage.id,
        itemName: `${game.name} - ${selectedPackage.label}`,
        enabledPayments,
        customerEmail: receiptEmail,
        customerPhone: receiptWhatsapp || undefined,
      });
    } catch (error) {
      await Promise.all([
        pricing.pointsRedeemed > 0
          ? restoreOrderPointsRedemption(orderId).catch((restoreError) =>
              console.error(
                `Failed to restore points after Snap error for ${orderId}`,
                restoreError,
              ),
            )
          : Promise.resolve(),
        pricing.promoCode
          ? syncPromotionLifecycle(orderId, "cancelled").catch((promoError) =>
              console.error(
                `Failed to release promo after Snap error for ${orderId}`,
                promoError,
              ),
            )
          : Promise.resolve(),
        supabaseUpdate(
          "orders",
          { status: "cancelled", updated_at: new Date().toISOString() },
          { filters: { id: `eq.${orderId}` } },
        ),
        supabaseUpdate(
          "payments",
          { status: "failure", raw_status: "snap_create_failed", updated_at: new Date().toISOString() },
          { filters: { order_id: `eq.${orderId}`, provider: "eq.midtrans" } },
        ),
      ]);
      throw error;
    }

    await supabaseUpdate(
      "payments",
      {
        snap_token: snap.token,
        redirect_url: snap.redirectUrl,
        raw_status: "pending",
        updated_at: new Date().toISOString(),
      },
      { filters: { order_id: `eq.${orderId}`, provider: "eq.midtrans" } },
    );

    const order = await getPublicOrder(orderId);
    if (!order) throw new Error("Order tidak ditemukan setelah dibuat.");

    const responseHeaders = new Headers({
      "Cache-Control": "private, no-store",
    });
    responseHeaders.append("Set-Cookie", createOrderAccessCookie(orderId, access.token));
    appendResolvedNambahAuthCookies(responseHeaders, auth);

    return Response.json(
      { order, accessToken: access.token },
      {
        status: 201,
        headers: responseHeaders,
      },
    );
  } catch (error) {
    console.error("Midtrans Sandbox order creation failed", error);
    return Response.json(
      { error: "Gagal membuat pembayaran Midtrans Sandbox." },
      { status: 502 },
    );
  }
}
