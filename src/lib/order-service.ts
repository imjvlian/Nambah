import { fulfillPaidOrder } from "@/lib/fulfillment";
import {
  getMidtransEnvironment,
  type MidtransStatusPayload,
} from "@/lib/midtrans/client";
import { getDokuCheckoutJsUrl } from "@/lib/payments/doku";
import type { PublicOrder, PublicOrderStatus } from "@/lib/order-public";
import { syncOrderPointsLifecycle } from "@/lib/loyalty";
import { syncOrderCommissionLifecycle } from "@/lib/commission-service";
import { syncPromotionLifecycle } from "@/lib/promotion-service";
import { deliverSuccessReceipt } from "@/lib/receipt-service";
import { supabaseInsert, supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import { isTerminalStatus } from "./order-status";
import {
  nextOrderStatusFromPayment,
  normalizePaymentStatus,
  type NormalizedPaymentStatus,
} from "@/lib/payment-status-policy";

type OrderRow = {
  id: string;
  game_id: string;
  product_id: string;
  payment_method_id: string;
  target_user_id: string;
  target_server_id: string | null;
  promotion_code: string | null;
  affiliate_code: string | null;
  status: PublicOrderStatus;
  /** Kode pindai kasir - hanya order merchant_retail (migrasi 039). */
  merchant_scan_code: string | null;
  selling_price: number | string;
  customer_payment_fee: number | string;
  promotion_discount: number | string;
  referral_discount: number | string;
  points_redeemed: number | string;
  points_discount: number | string;
  points_earned: number | string;
  final_price: number | string;
  expires_at: string | null;
  status_changed_at: string | null;
  terminal_at: string | null;
  created_at: string;
  updated_at: string;
};

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  accent: string;
  initials: string;
};

type ProductRow = {
  id: string;
  label: string;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  detail: string;
};

type PaymentRow = {
  order_id: string;
  provider: string;
  status: string;
  raw_status: string | null;
  payment_type: string | null;
  snap_token: string | null;
  redirect_url: string | null;
  paid_at: string | null;
  provider_transaction_id: string | null;
};

type PaymentPayloadRow = {
  order_id: string;
  payment_payload: {
    mode?: string;
    qrContent?: string;
    expiresAt?: string | null;
  } | null;
};

type SupplierTransactionPublicRow = {
  order_id: string;
  status: string;
  serial_number: string | null;
};

type MidtransSource = "webhook" | "status_api";

export async function getPublicOrder(orderId: string): Promise<PublicOrder | null> {
  const [order] = await supabaseSelect<OrderRow>("orders", {
    select:
      "id,game_id,product_id,payment_method_id,target_user_id,target_server_id,promotion_code,affiliate_code,status,selling_price,customer_payment_fee,promotion_discount,referral_discount,points_redeemed,points_discount,points_earned,final_price,created_at,updated_at,expires_at,status_changed_at,terminal_at,merchant_scan_code",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  if (!order) return null;

  const [gameRows, productRows, paymentMethodRows, paymentRows, supplierTxRows] = await Promise.all([
    supabaseSelect<GameRow>("games", {
      select: "id,name,short_name,accent,initials",
      filters: { id: `eq.${order.game_id}` },
      limit: 1,
    }),
    supabaseSelect<ProductRow>("products", {
      select: "id,label",
      filters: { id: `eq.${order.product_id}` },
      limit: 1,
    }),
    supabaseSelect<PaymentMethodRow>("payment_methods", {
      select: "id,name,detail",
      filters: { id: `eq.${order.payment_method_id}` },
      limit: 1,
    }),
    supabaseSelect<PaymentRow>("payments", {
      select:
        "order_id,provider,status,raw_status,payment_type,snap_token,redirect_url,paid_at,provider_transaction_id",
      // Tanpa filter provider: baris terbaru per order adalah sesi gateway
      // yang aktif untuk order itu (Midtrans hari ini, DOKU menyusul).
      filters: { order_id: `eq.${order.id}` },
      order: "created_at.desc",
      limit: 1,
    }),
    supabaseSelect<SupplierTransactionPublicRow>("supplier_transactions", {
      select: "order_id,status,serial_number",
      filters: { order_id: `eq.${order.id}` },
      order: "created_at.desc",
      limit: 1,
    }),
  ]);

  const game = gameRows[0];
  const product = productRows[0];
  const paymentMethod = paymentMethodRows[0];
  const payment = paymentRows[0];
  const supplierTx = supplierTxRows[0];

  if (!game || !product || !paymentMethod) {
    throw new Error(`Order ${order.id} memiliki referensi katalog yang tidak lengkap.`);
  }

  // Sesi DOKU (konten QRIS dll) disimpan di payments.payment_payload — kolom
  // dari migrasi 026. Diambil terpisah + try/catch supaya order view tidak
  // rusak saat migrasi belum dijalankan.
  let dokuSession: PaymentPayloadRow["payment_payload"] = null;
  if (payment?.provider === "doku") {
    try {
      const payloadRows = await supabaseSelect<PaymentPayloadRow>("payments", {
        select: "order_id,payment_payload",
        filters: { order_id: `eq.${order.id}`, provider: "eq.doku" },
        order: "created_at.desc",
        limit: 1,
      });
      dokuSession = payloadRows[0]?.payment_payload ?? null;
    } catch {
      dokuSession = null;
    }
  }

  return {
    id: order.id,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    // Wajib diteruskan: tanpa ini `calculateCountdown` di OrderStatusView
    // selalu menerima `undefined` sehingga countdown "kedaluwarsa dalam 30
    // menit" tidak pernah tampil, padahal server memang menegakkan
    // `expires_at` lewat sweeper order kedaluwarsa.
    expiresAt: order.expires_at,
    statusChangedAt: order.status_changed_at,
    terminalAt: order.terminal_at,
    mode:
      getMidtransEnvironment() === "production"
        ? "midtrans-production"
        : "midtrans-sandbox",
    status: order.status,
    product: {
      gameId: game.id,
      gameName: game.name,
      shortName: game.short_name,
      packageId: product.id,
      packageLabel: product.label,
      accent: game.accent,
      initials: game.initials,
    },
    account: {
      userId: order.target_user_id,
      ...(order.target_server_id ? { serverId: order.target_server_id } : {}),
    },
    payment: {
      id: paymentMethod.id,
      name: paymentMethod.name,
      detail: paymentMethod.detail,
      provider: payment?.provider === "doku" ? "doku" : "midtrans",
      providerStatus: payment?.raw_status ?? payment?.status ?? "pending",
      paymentType: payment?.payment_type ?? null,
      snapToken: payment?.snap_token ?? null,
      redirectUrl: payment?.redirect_url ?? null,
      paidAt: payment?.paid_at ?? null,
      providerTransactionId: payment?.provider_transaction_id ?? null,
    },
    // Hanya order ritel yang punya. Exposed ke pemilik order lewat token
    // akses yang sudah diberikan - ini memang tujuannya, supaya pelanggan
    // bisa menunjuk layar ke kasir.
    merchantScanCode: order.merchant_scan_code ?? null,
    ...(payment?.provider === "doku"
      ? {
          doku: {
            ...(dokuSession?.qrContent
              ? { qrContent: dokuSession.qrContent, expiresAt: dokuSession.expiresAt ?? null }
              : {}),
            // Mode checkout: modal Jokul dirender di halaman Nambah.
            ...(payment.redirect_url ? { checkoutJsUrl: getDokuCheckoutJsUrl() } : {}),
          },
        }
      : {}),
    pricing: {
      sellingPrice: Number(order.selling_price),
      promotionDiscount: Number(order.promotion_discount),
      referralDiscount: Number(order.referral_discount),
      pointsDiscount: Number(order.points_discount),
      pointsRedeemed: Number(order.points_redeemed),
      pointsEarned: Number(order.points_earned),
      customerPaymentFee: Number(order.customer_payment_fee),
      finalPrice: Number(order.final_price),
    },
    ...(order.promotion_code ? { promoCode: order.promotion_code } : {}),
    ...(order.affiliate_code ? { referralCode: order.affiliate_code } : {}),
    // SN hanya diekspos saat order sukses — pada status lain nilainya
    // belum final (atau transaksi gagal) dan bisa menyesatkan customer.
    ...(order.status === "success" && supplierTx?.serial_number
      ? { serialNumber: supplierTx.serial_number }
      : {}),
  };
}

export async function applyMidtransStatus(
  payload: MidtransStatusPayload,
  source: MidtransSource,
  signatureVerified: boolean,
) {
  const orderId = payload.order_id?.trim() ?? "";
  if (!orderId) throw new Error("Midtrans payload tidak memiliki order_id.");

  const [order] = await supabaseSelect<OrderRow>("orders", {
    select:
      "id,game_id,product_id,payment_method_id,target_user_id,target_server_id,promotion_code,affiliate_code,status,selling_price,customer_payment_fee,promotion_discount,referral_discount,points_redeemed,points_discount,points_earned,final_price,created_at,updated_at,expires_at,status_changed_at,terminal_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  if (!order) throw new Error(`Order ${orderId} tidak ditemukan.`);

  /*
   * Order merchant ritol TIDAK BOLEH disentuh webhook Midtrans.
   *
   * Order itu tidak pernah punya sesi gateway sama sekali - tidak ada
   * `snapToken`, tidak ada `payments` row. Jadi webhook yang tiba untuk
   * order merchant berarti salah orderId atau sengaja dikirim
   * mengirimnya. Menjalankannya akan mengembalikan status ke jalur payment
   * dan, untuk `settlement`, menandai order sudah dibayar padahal user
   * membayarnya ke merchant di konter.
   *
   * Ditolak SEBELUM validasi jumlah, karena error "tidak cocok" akan
   * membocorkan bahwa order itu ada dan belum dibayar.
   */
  if (order.status === "pending_merchant" || order.status === "awaiting_receivable") {
    throw new Error(
      `Order ${orderId} adalah order merchant ritel dan tidak punya sesi pembayaran gateway.`,
    );
  }

  const grossAmount = Number(payload.gross_amount);
  if (!Number.isFinite(grossAmount) || Math.round(grossAmount) !== Number(order.final_price)) {
    throw new Error(`Gross amount Midtrans tidak cocok untuk order ${orderId}.`);
  }

  const now = new Date().toISOString();
  const paymentStatus: NormalizedPaymentStatus = normalizePaymentStatus(
    payload.transaction_status,
  );
  const orderStatus = nextOrderStatusFromPayment(order.status, {
    transactionStatus: payload.transaction_status,
    fraudStatus: payload.fraud_status,
  });
  const paid = orderStatus === "paid" || orderStatus === "processing" || orderStatus === "success";

  // Update timestamps for status changes
  const updatePayload: Record<string, unknown> = {};
  if (orderStatus !== order.status) {
    updatePayload.status = orderStatus;
    updatePayload.status_changed_at = now;
    if (isTerminalStatus(orderStatus)) {
      updatePayload.terminal_at = now;
    }
    if (orderStatus === "paid" && (order.status === "pending_payment" || order.status === null)) {
      updatePayload.paid_at = payload.settlement_time ?? now;
    }
    updatePayload.updated_at = now;
  } else {
    updatePayload.updated_at = now;
  }

  const paymentUpdate = await supabaseUpdate<PaymentRow>(
    "payments",
    {
      provider_transaction_id: payload.transaction_id ?? null,
      status: paymentStatus,
      raw_status: payload.transaction_status ?? "pending",
      payment_type: payload.payment_type ?? null,
      fraud_status: payload.fraud_status ?? null,
      ...(signatureVerified ? { signature_verified_at: now } : {}),
      ...(paid ? { paid_at: payload.settlement_time ?? now } : {}),
      updated_at: now,
    },
    {
      filters: { order_id: `eq.${orderId}`, provider: "eq.midtrans" },
    },
  );

  if (paymentUpdate.length === 0) {
    throw new Error(`Payment Midtrans untuk order ${orderId} tidak ditemukan.`);
  }

  if (orderStatus !== order.status) {
    const orderUpdatePayload: Record<string, unknown> = { status: orderStatus, updated_at: now };
    if (orderStatus === "paid") {
      orderUpdatePayload.paid_at = payload.settlement_time ?? now;
    }
    if (isTerminalStatus(orderStatus)) {
      orderUpdatePayload.terminal_at = now;
    }
    orderUpdatePayload.status_changed_at = now;

    await supabaseUpdate("orders", orderUpdatePayload, { filters: { id: `eq.${orderId}` } });
  }

  try {
    await syncOrderPointsLifecycle(orderId, orderStatus);
  } catch (error) {
    // Payment truth must not be rolled back by a loyalty subsystem issue.
    // Repeated status checks and fulfillment finalization will retry idempotently.
    console.error(`Lacte Points lifecycle sync failed for order ${orderId}`, error);
  }

  try {
    await syncOrderCommissionLifecycle(orderId, orderStatus);
  } catch (error) {
    console.error(`Affiliate commission lifecycle sync failed for order ${orderId}`, error);
  }

  try {
    await syncPromotionLifecycle(orderId, orderStatus);
  } catch (error) {
    console.error(`Promotion lifecycle sync failed for order ${orderId}`, error);
  }

  await supabaseInsert("midtrans_payment_events", {
    order_id: orderId,
    transaction_id: payload.transaction_id ?? null,
    transaction_status: payload.transaction_status ?? "unknown",
    status_code: payload.status_code ?? null,
    gross_amount: payload.gross_amount ?? null,
    payment_type: payload.payment_type ?? null,
    fraud_status: payload.fraud_status ?? null,
    source,
    signature_verified: signatureVerified,
    payload,
    received_at: now,
  });

  // Payment success and fulfillment are deliberately decoupled. A supplier
  // outage must never erase a verified Midtrans payment. Repeated webhook or
  // manual refresh calls are safe because fulfillment uses a deterministic
  // supplier request_ref per order.
  if (orderStatus === "paid" || orderStatus === "processing") {
    try {
      await fulfillPaidOrder(orderId);
    } catch (error) {
      console.error(`Fulfillment trigger failed for order ${orderId}`, error);
    }
  }

  const publicOrder = await getPublicOrder(orderId);
  if (!publicOrder) throw new Error(`Order ${orderId} hilang setelah update.`);

  // Receipt delivery is intentionally retried from the payment/status path as
  // well as fulfillment. This covers orders that were already success before
  // Brevo was enabled and explicit provider failures from an earlier attempt.
  // deliverSuccessReceipt is idempotent after a successful send.
  if (publicOrder.status === "success") {
    try {
      const receipt = await deliverSuccessReceipt(orderId);
      if (
        receipt.status !== "sent" &&
        receipt.status !== "disabled" &&
        receipt.status !== "sending"
      ) {
        console.warn(`Receipt for order ${orderId}: ${receipt.status}`);
      }
    } catch (error) {
      console.error(`Receipt retry failed for order ${orderId}`, error);
    }
  }

  return publicOrder;
}

// ---------------------------------------------------------------------------
// DOKU
// ---------------------------------------------------------------------------

export type DokuApplyInput = {
  orderId: string;
  referenceNo: string | null;
  /** Status ternormalisasi gaya Midtrans (dari mapDokuTransactionStatus). */
  transactionStatus: string;
  transactionStatusDesc?: string | null;
  paidTime?: string | null;
  /** Nominal string DOKU ("10000.00") untuk validasi jumlah. */
  amountValue?: string | null;
  /** Channel pembayaran (qris / QRIS_DOKU / VIRTUAL_ACCOUNT_BCA / ...). */
  paymentType?: string | null;
  /** Payload mentah notifikasi/query terakhir — disimpan di payment_payload. */
  raw?: unknown;
};

export async function applyDokuStatus(
  input: DokuApplyInput,
  source: MidtransSource,
  signatureVerified: boolean,
) {
  const orderId = input.orderId.trim();
  if (!orderId) throw new Error("DOKU payload tidak memiliki order id.");

  const [order] = await supabaseSelect<OrderRow>("orders", {
    select:
      "id,game_id,product_id,payment_method_id,target_user_id,target_server_id,promotion_code,affiliate_code,status,selling_price,customer_payment_fee,promotion_discount,referral_discount,points_redeemed,points_discount,points_earned,final_price,created_at,updated_at,expires_at,status_changed_at,terminal_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });
  if (!order) throw new Error(`Order ${orderId} tidak ditemukan.`);

  // Sama seperti jalur Midtrans: order merchant ritel tidak punya sesi
  // gateway, jadi notifikasi DOKU untuk order itu tidak mungkin sah.
  if (order.status === "pending_merchant" || order.status === "awaiting_receivable") {
    throw new Error(
      `Order ${orderId} adalah order merchant ritel dan tidak punya sesi pembayaran gateway.`,
    );
  }

  // Validasi jumlah sama ketatnya dengan jalur Midtrans.
  if (input.amountValue) {
    const amount = Number(input.amountValue);
    if (!Number.isFinite(amount) || Math.round(amount) !== Number(order.final_price)) {
      throw new Error(`Jumlah DOKU tidak cocok untuk order ${orderId}.`);
    }
  }

  const now = new Date().toISOString();
  const paymentStatus = normalizePaymentStatus(input.transactionStatus);
  const orderStatus = nextOrderStatusFromPayment(order.status, {
    transactionStatus: input.transactionStatus,
    fraudStatus: null,
  });
  const paid =
    orderStatus === "paid" || orderStatus === "processing" || orderStatus === "success";

  const paymentUpdatePayload: Record<string, unknown> = {
    ...(input.referenceNo ? { provider_transaction_id: input.referenceNo } : {}),
    status: paymentStatus,
    raw_status: input.transactionStatus,
    payment_type: input.paymentType ?? "qris",
    fraud_status: null,
    ...(signatureVerified ? { signature_verified_at: now } : {}),
    ...(paid ? { paid_at: input.paidTime ?? now } : {}),
    updated_at: now,
  };

  // Simpan payload mentah terakhir untuk audit (digabung dengan sesi QR yang
  // sudah ada — qrContent tidak boleh tertimpa).
  if (input.raw !== undefined) {
    try {
      const existing = await supabaseSelect<{ payment_payload: Record<string, unknown> | null }>(
        "payments",
        {
          select: "payment_payload",
          filters: { order_id: `eq.${orderId}`, provider: "eq.doku" },
          order: "created_at.desc",
          limit: 1,
        },
      );
      const previous = existing[0]?.payment_payload ?? {};
      paymentUpdatePayload.payment_payload = {
        ...previous,
        lastStatus: input.raw,
        lastStatusSource: source,
        lastStatusAt: now,
      };
    } catch (error) {
      // Kolom payment_payload belum ada (migrasi 026 belum jalan) — status
      // tetap diterapkan, audit mentah menyusul setelah migrasi.
      console.error(`payment_payload update skipped for order ${orderId}`, error);
    }
  }

  const paymentUpdate = await supabaseUpdate<PaymentRow>(
    "payments",
    paymentUpdatePayload,
    { filters: { order_id: `eq.${orderId}`, provider: "eq.doku" } },
  );
  if (paymentUpdate.length === 0) {
    throw new Error(`Payment DOKU untuk order ${orderId} tidak ditemukan.`);
  }

  if (orderStatus !== order.status) {
    const orderUpdatePayload: Record<string, unknown> = {
      status: orderStatus,
      updated_at: now,
      status_changed_at: now,
    };
    if (orderStatus === "paid") {
      orderUpdatePayload.paid_at = input.paidTime ?? now;
    }
    if (isTerminalStatus(orderStatus)) {
      orderUpdatePayload.terminal_at = now;
    }
    await supabaseUpdate("orders", orderUpdatePayload, { filters: { id: `eq.${orderId}` } });
  }

  try {
    await syncOrderPointsLifecycle(orderId, orderStatus);
  } catch (error) {
    console.error(`Lacte Points lifecycle sync failed for order ${orderId}`, error);
  }
  try {
    await syncOrderCommissionLifecycle(orderId, orderStatus);
  } catch (error) {
    console.error(`Affiliate commission lifecycle sync failed for order ${orderId}`, error);
  }
  try {
    await syncPromotionLifecycle(orderId, orderStatus);
  } catch (error) {
    console.error(`Promotion lifecycle sync failed for order ${orderId}`, error);
  }

  // Fulfillment decoupled — sama seperti jalur Midtrans.
  if (orderStatus === "paid" || orderStatus === "processing") {
    try {
      await fulfillPaidOrder(orderId);
    } catch (error) {
      console.error(`Fulfillment trigger failed for order ${orderId}`, error);
    }
  }

  const publicOrder = await getPublicOrder(orderId);
  if (!publicOrder) throw new Error(`Order ${orderId} hilang setelah update.`);

  if (publicOrder.status === "success") {
    try {
      const receipt = await deliverSuccessReceipt(orderId);
      if (
        receipt.status !== "sent" &&
        receipt.status !== "disabled" &&
        receipt.status !== "sending"
      ) {
        console.warn(`Receipt for order ${orderId}: ${receipt.status}`);
      }
    } catch (error) {
      console.error(`Receipt retry failed for order ${orderId}`, error);
    }
  }

  return publicOrder;
}


export async function isOrderOwnedByUser(orderId: string, userId: string) {
  if (!orderId || !userId) return false;
  const rows = await supabaseSelect<{ id: string }>("orders", {
    select: "id",
    filters: {
      id: `eq.${orderId}`,
      customer_user_id: `eq.${userId}`,
    },
    limit: 1,
  });
  return rows.length > 0;
}
