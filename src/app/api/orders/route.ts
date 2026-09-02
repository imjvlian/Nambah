import { randomUUID } from "node:crypto";
import { validateGameAccountTarget } from "@/lib/game-account";
import { createMidtransSnapTransaction, isMidtransSandboxConfigured } from "@/lib/midtrans/client";
import { getPublicOrder } from "@/lib/order-service";
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

  const pricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion,
    referral,
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

  try {
    await supabaseInsert("orders", {
      id: orderId,
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
      final_price: pricing.finalPrice,
      net_profit_before_affiliate: pricing.netProfitBeforeAffiliate,
      affiliate_rate: pricing.affiliateRate,
      affiliate_commission: pricing.affiliateCommission,
      nambah_profit: pricing.nambahProfit,
      created_at: now,
      updated_at: now,
    });

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
      });
    } catch (error) {
      await Promise.all([
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

    return Response.json({ order }, { status: 201 });
  } catch (error) {
    console.error("Midtrans Sandbox order creation failed", error);
    return Response.json(
      { error: "Gagal membuat pembayaran Midtrans Sandbox." },
      { status: 502 },
    );
  }
}
