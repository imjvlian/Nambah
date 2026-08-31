import type { MidtransStatusPayload } from "@/lib/midtrans/client";
import type { PublicOrder, PublicOrderStatus } from "@/lib/order-public";
import { supabaseInsert, supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";

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
  selling_price: number | string;
  customer_payment_fee: number | string;
  promotion_discount: number | string;
  referral_discount: number | string;
  final_price: number | string;
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
};

type MidtransSource = "webhook" | "status_api";

type PaymentStatus =
  | "pending"
  | "settlement"
  | "capture"
  | "deny"
  | "cancel"
  | "expire"
  | "refund"
  | "failure";

function normalizePaymentStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case "settlement":
    case "capture":
    case "deny":
    case "cancel":
    case "expire":
    case "refund":
    case "failure":
      return status;
    case "partial_refund":
      return "refund";
    default:
      return "pending";
  }
}

function nextOrderStatus(
  current: PublicOrderStatus,
  payload: MidtransStatusPayload,
): PublicOrderStatus {
  const status = payload.transaction_status ?? "pending";
  const fraudStatus = payload.fraud_status?.toLowerCase();

  if (status === "refund" || status === "partial_refund") return "refunded";
  if (current === "refunded") return current;

  const paid =
    status === "settlement" ||
    (status === "capture" && (!fraudStatus || fraudStatus === "accept"));

  if (paid) {
    if (current === "processing" || current === "success") return current;
    return "paid";
  }

  if (current === "paid" || current === "processing" || current === "success") {
    return current;
  }

  if (status === "expire" || status === "cancel") return "cancelled";
  if (status === "failure") return "failed";

  // A denied attempt in Snap can still be retried under the same order ID.
  return "pending_payment";
}

export async function getPublicOrder(orderId: string): Promise<PublicOrder | null> {
  const [order] = await supabaseSelect<OrderRow>("orders", {
    select:
      "id,game_id,product_id,payment_method_id,target_user_id,target_server_id,promotion_code,affiliate_code,status,selling_price,customer_payment_fee,promotion_discount,referral_discount,final_price,created_at,updated_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  if (!order) return null;

  const [gameRows, productRows, paymentMethodRows, paymentRows] = await Promise.all([
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
        "order_id,provider,status,raw_status,payment_type,snap_token,redirect_url,paid_at",
      filters: { order_id: `eq.${order.id}`, provider: "eq.midtrans" },
      order: "created_at.desc",
      limit: 1,
    }),
  ]);

  const game = gameRows[0];
  const product = productRows[0];
  const paymentMethod = paymentMethodRows[0];
  const payment = paymentRows[0];

  if (!game || !product || !paymentMethod) {
    throw new Error(`Order ${order.id} memiliki referensi katalog yang tidak lengkap.`);
  }

  return {
    id: order.id,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    mode: "midtrans-sandbox",
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
      provider: "midtrans",
      providerStatus: payment?.raw_status ?? payment?.status ?? "pending",
      paymentType: payment?.payment_type ?? null,
      snapToken: payment?.snap_token ?? null,
      redirectUrl: payment?.redirect_url ?? null,
      paidAt: payment?.paid_at ?? null,
    },
    pricing: {
      sellingPrice: Number(order.selling_price),
      promotionDiscount: Number(order.promotion_discount),
      referralDiscount: Number(order.referral_discount),
      customerPaymentFee: Number(order.customer_payment_fee),
      finalPrice: Number(order.final_price),
    },
    ...(order.promotion_code ? { promoCode: order.promotion_code } : {}),
    ...(order.affiliate_code ? { referralCode: order.affiliate_code } : {}),
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
      "id,game_id,product_id,payment_method_id,target_user_id,target_server_id,promotion_code,affiliate_code,status,selling_price,customer_payment_fee,promotion_discount,referral_discount,final_price,created_at,updated_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  if (!order) throw new Error(`Order ${orderId} tidak ditemukan.`);

  const grossAmount = Number(payload.gross_amount);
  if (!Number.isFinite(grossAmount) || Math.round(grossAmount) !== Number(order.final_price)) {
    throw new Error(`Gross amount Midtrans tidak cocok untuk order ${orderId}.`);
  }

  const now = new Date().toISOString();
  const paymentStatus = normalizePaymentStatus(payload.transaction_status);
  const orderStatus = nextOrderStatus(order.status, payload);
  const paid = orderStatus === "paid" || orderStatus === "processing" || orderStatus === "success";

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
    await supabaseUpdate(
      "orders",
      {
        status: orderStatus,
        ...(orderStatus === "paid" ? { paid_at: payload.settlement_time ?? now } : {}),
        updated_at: now,
      },
      { filters: { id: `eq.${orderId}` } },
    );
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

  const publicOrder = await getPublicOrder(orderId);
  if (!publicOrder) throw new Error(`Order ${orderId} hilang setelah update.`);
  return publicOrder;
}
