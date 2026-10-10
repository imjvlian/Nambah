import {
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { readLinkReferralCode } from "@/lib/affiliate-link-cookie";
import { randomUUID } from "node:crypto";
import {
  isValidReceiptEmail,
  normalizeReceiptEmail,
  normalizeReceiptWhatsapp,
  isValidIndonesianWhatsapp,
  validateGuestReceiptContact,
} from "@/lib/customer-contact";
import { validateGameAccountTarget } from "@/lib/game-account";
import { MERCHANT_RETAIL_PAYMENT_METHOD_ID } from "@/lib/catalog";
import {
  MERCHANT_ORDER_EXPIRY_WINDOW_MS,
  checkMerchantCredit,
  getMerchantById,
  isMerchantRetailEnabled,
  type MerchantRow,
} from "@/lib/merchant-retail";
import {
  getPointsSummary,
  maxRedeemablePointsForSubtotal,
  pointsToIdr,
  reserveOrderPoints,
  validateRequestedPoints,
} from "@/lib/loyalty";
import { isMidtransConfigured } from "@/lib/midtrans/client";
import { createPaymentSession } from "@/lib/payments";
import { rateLimitResponse } from "@/lib/rate-limit";
import { reservePromotionForOrder } from "@/lib/promotion-service";
import { cancelOrderWithCleanup } from "@/lib/order-cancellation";
import { getPublicOrder } from "@/lib/order-service";
import {
  createOrderAccessCookie,
  createOrderAccessCredential,
} from "@/lib/order-access";
import { calculatePricing } from "@/lib/pricing";
import { getPricingContext } from "@/lib/pricing-repository";
import { isSupabaseConfigured, supabaseInsert, supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

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
  /**
   * Merchant yang dipilih untuk jalur ritel.
   *
   * WAJIB eksplisit — tidak ada default. Kalau merchant dipilih otomatis,
   * user bisa membayar ke toko yang tidak ia pilih. Divalidasi ulang di
   * server: nilai ini datang dari browser dan tidak boleh dipercaya.
   */
  merchantId?: string;
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

export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, {
    scope: "order-create",
    limit: 15,
    windowSeconds: 10 * 60,
  });
  if (limited) return limited;

  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: `Database ${BRAND.shortName} belum dikonfigurasi untuk membuat order.` },
      { status: 503 },
    );
  }

  if (!isMidtransConfigured()) {
    return Response.json(
      { error: "Midtrans belum dikonfigurasi." },
      { status: 503 },
    );
  }

  let body: CreateOrderBody;
  try {
    body = (await request.json()) as CreateOrderBody;
  } catch {
    return Response.json({ error: "Request order tidak valid." }, { status: 400 });
  }

  // Sengaja TIDAK dipotong di sini. Nilai mentah diteruskan ke
  // `validateGameAccountTarget`, yang menolak input kelewat panjang dengan pesan
  // milik game tersebut. Versi lama memakai `clean(value, 64)` yang memotong
  // diam-diam: User ID 70 karakter jadi 64, lolos validasi, lalu ID yang salah
  // itu dikirim ke supplier.
  const targetUserId = body.targetUserId ?? "";
  const targetServerId = body.targetServerId ?? "";
  const auth = await resolveNambahAuth(request);

  let receiptEmail = "";
  let receiptWhatsapp = "";
  if (auth.user) {
    receiptEmail = normalizeReceiptEmail(auth.user.email);
    if (!receiptEmail || !isValidReceiptEmail(receiptEmail)) {
      return Response.json(
        { error: `Email akun ${BRAND.shortName} tidak tersedia untuk receipt.` },
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
    userId: auth.user?.id ?? null,
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
    linkAffiliate,
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

  /*
 * Jalur merchant Dan jalur Midtrans/DOKU dipisah di sini, bukan digabung.
 *
 * Jalur merchant TIDAK lewat payment gateway sama sekali: user membayar ke
 * merchant, merchant yang scan kodenya. Jadi semua gate Midtrans di bawah
 * (payment type, expiry window, webhook) TIDAK berlaku untuknya — memaksa
 * order merchant lewat Midtrans akan membuat customer membayar dua kali.
 *
 * Sebaliknya, jalur merchant punya gate sendiri: env flag, merchant harus
 * ada dan aktif, dan kapasitas piutangnya harus cukup.
 */
const isMerchantRetail = paymentMethod.id === MERCHANT_RETAIL_PAYMENT_METHOD_ID;
let merchant: MerchantRow | null = null;

/*
 * Hanya dipakai di jalur gateway. Di jalur merchant nilainya tidak pernah
 * dibaca — `createPaymentSession` seluruhnya dilewati. tetap dideklarasikan di
 * luar `else` karena TypeScript membutuhkannya ada di scope saat blok
 * `if (!isMerchantRetail)` dievaluasi.
 */
let enabledPayments: string[] = [];

if (isMerchantRetail) {
  if (!isMerchantRetailEnabled()) {
    return Response.json(
      { error: "Pembelian lewat toko ritel belum tersedia." },
      { status: 403 },
    );
  }

  // Merchant dipilih eksplisit. Tidak ada default: memilih merchant acak
  // berarti user membayar ke orang yang tidak dipilihnya.
  const requestedMerchantId =
    typeof body.merchantId === "string" ? body.merchantId.trim() : "";
  if (!requestedMerchantId) {
    return Response.json(
      { error: "Pilih toko ritel sebelum melanjutkan checkout." },
      { status: 400 },
    );
  }

  merchant = await getMerchantById(requestedMerchantId);
  if (!merchant) {
    return Response.json(
      { error: "Toko ritel yang dipilih tidak ditemukan." },
      { status: 404 },
    );
  }

  const credit = await checkMerchantCredit(merchant.id);
  if (!credit.eligible) {
    return Response.json({ error: credit.reason }, { status: 409 });
  }
} else {
  enabledPayments = MIDTRANS_PAYMENT_MAP[paymentMethod.id] ?? [];
  if (!enabledPayments.length) {
    return Response.json(
      { error: "Metode pembayaran belum didukung Midtrans." },
      { status: 400 },
    );
  }
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
    linkAffiliate,
    loyaltyEligible: Boolean(auth.user),
    minimumNambahProfit,
    // Biaya layanan merchant, dibaca dari baris `merchants` yang sudah
    // dicek di atas. Nilainya di-snapshot ke order nanti — kalau admin
    // mengubah tarif setelah checkout, order lama tidak boleh ikut berubah.
    merchantServiceFeePercent: isMerchantRetail
      ? Number(merchant?.service_fee_percent ?? 0)
      : 0,
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
        { error: "Login diperlukan untuk menggunakan Lacte Points." },
        { status: 401 },
      );
    }

    const points = await getPointsSummary(auth.user.id);
    if (points.available < pointsRequest.points) {
      return Response.json(
        { error: `Lacte Points tersedia hanya ${points.available} points.` },
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
              ? `Maksimum penggunaan untuk transaksi ini adalah ${maxPoints} Lacte Points.`
              : "Lacte Points belum dapat digunakan pada transaksi ini.",
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

  /*
   * Jangka kedaluwarsa berbeda per jalur, dan alasannya berbeda.
   *
   * Midtrans/DOKU: 30 menit, karena pembayaran sudah otomatis dan tidak
   * butuh orang.
   *
   * Merchant: 2 jam, karena yang ditunggu bukan transfer online melainkan
   * orang datang ke konter dengan uang tunai. 30 menit tidak realistis —
   * kode akan kedaluwarsa sebelum merchant sempat ke sana.
   */
  const expiresAt = new Date(
    Date.now() +
      (isMerchantRetail ? MERCHANT_ORDER_EXPIRY_WINDOW_MS : 30 * 60 * 1000),
  ).toISOString();

  const access = createOrderAccessCredential();

  // Pembuatan order di bawah ini adalah saga 6 langkah, bukan transaksi: ada
  // panggilan ke Midtrans di tengah-tengahnya, jadi membungkusnya dalam DB
  // transaction tidak mungkin. Kalau proses mati (timeout, cold start, deploy)
  // di salah satu langkah, order tetap ada dengan status `pending_payment`.
  //
  // Jendela bocornya dibatasi oleh sweeper kedaluwarsa (`lib/order-expiry.ts`):
  // order yatim seperti itu akan dibatalkan dan reservasi points/promo-nya
  // dilepas paling lama `expires_at` + grace 5 menit + selisih cron (10 menit).
  // Sebelumnya tidak ada penanganan apa pun, jadi reservasi terkunci permanen.
  //
  // Karena itu SEMUA jalur pembatalan di dalam saga ini harus lewat
  // `cancelOrderWithCleanup` — helper itu idempoten lewat compare-and-swap pada
  // `status`, jadi dipanggil dari jalur kompensasi maupun sweeper tidak akan
  // saling menimpa.
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
      affiliate_code: pricing.affiliateCode,
      supplier_id: "digiflazz",
      // Status awal berbeda per jalur. `pending_merchant` TIDAK boleh masuk
      // sweeper 30 menit — setelah merchant scan, order sudah irreversible
      // di sisi supplier dan membatalkannya tidak membatalkan top up.
      status: isMerchantRetail ? "pending_merchant" : "pending_payment",
      reference_price: pricing.referencePrice,
      selling_price: pricing.sellingPrice,
      supplier_cost: pricing.supplierCost,
      customer_payment_fee: pricing.customerPaymentFee,
      merchant_payment_cost: pricing.merchantPaymentCost,
      // Snapshot merchant. Tanpa ini, admin mengubah tarif setelah user
      // checkout akan membuat nota dan piutang merchant berbeda.
      merchant_id: isMerchantRetail ? merchant?.id : null,
      service_fee_percent_snapshot: isMerchantRetail
        ? Number(merchant?.service_fee_percent ?? 0)
        : null,
      service_fee_amount: isMerchantRetail ? pricing.merchantServiceFee : null,
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
        await cancelOrderWithCleanup(orderId, "points_reservation_failed");
        throw new Error(
          error instanceof Error
            ? `Lacte Points gagal direservasi: ${error.message}`
            : "Lacte Points gagal direservasi.",
        );
      }
    }

    if (pricing.promoCode) {
      try {
        await reservePromotionForOrder(orderId);
      } catch (error) {
        // `cancelOrderWithCleanup` melepas points DAN promo sekaligus, jadi
        // jalur ini tidak perlu kompensasi terpisah.
        await cancelOrderWithCleanup(orderId, "promo_reservation_failed");
        throw new Error(
          error instanceof Error
            ? `Promo gagal direservasi: ${error.message}`
            : "Promo gagal direservasi.",
        );
      }
    }

    /*
     * Order merchant TIDAK membuat sesi payment gateway. User membayar
     * langsung ke merchant, jadi Madekan snapToken di sini akan membuat
     * customer ditagih dua kali — sekali di konter merchant, sekali lewat
     * gateway yang tidak pernah akan ia gunakan.
     *
     * Order merchant berhenti di status `pending_merchant` sampai merchant
     * scan kodenya. Fulfillment dijalankan dari sana, bukan dari webhook.
     */
    if (!isMerchantRetail) {
      // Sesi pembayaran dibuat lewat router gateway aktif (Midtrans / DOKU).
      // Provider dicatat di baris payments supaya webhook, status-check, dan
      // rekonsiliasi selalu mengikuti gateway pembuat order — bukan switch
      // global yang bisa berubah sewaktu-waktu.
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

      let session;
      try {
        session = await createPaymentSession({
          orderId,
          grossAmount: pricing.finalPrice,
          itemId: selectedPackage.id,
          itemName: `${game.name} - ${selectedPackage.label}`,
          paymentMethodId: paymentMethod.id,
          enabledPayments,
          customerEmail: receiptEmail,
          customerPhone: receiptWhatsapp || undefined,
        });
      } catch (error) {
        await cancelOrderWithCleanup(orderId, "snap_create_failed");
        await supabaseUpdate(
          "payments",
          { status: "failure", raw_status: "snap_create_failed", updated_at: new Date().toISOString() },
          { filters: { order_id: `eq.${orderId}` } },
        );
        throw error;
      }

      await supabaseUpdate(
        "payments",
        {
          provider: session.provider,
          snap_token: session.payload.snapToken ?? null,
          redirect_url: session.payload.redirectUrl ?? null,
          raw_status: "pending",
          updated_at: new Date().toISOString(),
        },
        { filters: { order_id: `eq.${orderId}` } },
      );

      // Sesi DOKU: simpan reference + payload (QR inline untuk SNAP, atau mode
      // checkout) agar bisa dirender & di-query statusnya. payment_payload butuh
      // migrasi 026 — kegagalannya tidak boleh menggagalkan order.
      if (session.provider === "doku") {
        const raw = session.payload.raw as
          | { referenceNo?: string; requestId?: string; mode?: string }
          | undefined;
        try {
          await supabaseUpdate(
            "payments",
            {
              provider_transaction_id: raw?.referenceNo ?? raw?.requestId ?? null,
              payment_type: session.payload.kind === "qris" ? "qris" : "checkout",
              payment_payload: {
                mode: raw?.mode ?? (session.payload.kind === "qris" ? "snap" : "checkout"),
                qrContent: session.payload.qrContent ?? null,
                expiresAt: session.payload.expiresAt ?? null,
                referenceNo: raw?.referenceNo ?? null,
                requestId: raw?.requestId ?? null,
              },
              updated_at: new Date().toISOString(),
            },
            { filters: { order_id: `eq.${orderId}` } },
          );
        } catch (error) {
          console.error(`DOKU session payload persist failed for order ${orderId}`, error);
        }
      }

    }

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
    console.error("Order creation failed", error);
    const detail = error instanceof Error ? error.message : "";

    /*
     * Jalur merchant TIDAK pernah menyentuh gateway sama sekali, jadi menyebut
     * Midtrans/DOKU di sini bukan cuma tidak akurat — ia membuat pelanggan mengira
     * masalahnya ada di sistem pembayaran, lalu mencoba ulang lewat kanal yang salah.
     */
    if (isMerchantRetail) {
      return Response.json(
        { error: "Gagal membuat pesanan toko ritel. Silakan coba lagi." },
        { status: 502 },
      );
    }

    const dokuFailure = /doku/i.test(detail);
    return Response.json(
      {
        error: dokuFailure
          ? `Gagal membuat pembayaran DOKU. ${detail}`.slice(0, 200)
          : "Gagal membuat pembayaran Midtrans.",
      },
      { status: 502 },
    );
  }
}
