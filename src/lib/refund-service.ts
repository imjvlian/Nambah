import {
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";
import { markOrderRefunded } from "@/lib/order-service";
import { refundDokuQrisPayment } from "@/lib/payments/doku";
import { refundMidtransPayment } from "@/lib/payments/midtrans";
import { notifyRefundProcessed, notifyRefundRequested } from "@/lib/telegram-alerts";
import type { PublicOrderStatus } from "@/lib/order-public";
import { BRAND } from "@/lib/brand";
import { formatIDR } from "@/lib/pricing";
import {
  isBrevoConfigured,
  isBrevoReceiptEnabled,
  sendBrevoTransactionalEmail,
} from "@/lib/brevo/client";

export type RefundStatus =
  | "requested"
  | "processing"
  | "completed"
  | "failed"
  | "rejected";

export type RefundProvider = "midtrans" | "doku" | "paylabs" | "manual";

export type RefundRow = {
  id: number;
  order_id: string;
  provider: RefundProvider;
  provider_refund_id: string | null;
  amount: number | string;
  reason: string;
  status: RefundStatus;
  requested_by_admin_user_id: string | null;
  processed_by_admin_user_id: string | null;
  provider_response: Record<string, unknown> | null;
  request_note: string | null;
  completed_note: string | null;
  requested_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

type OrderRefundRow = {
  id: string;
  status: PublicOrderStatus;
  final_price: number | string;
  paid_at: string | null;
  receipt_email: string | null;
  receipt_whatsapp: string | null;
};

type PaymentRefundRow = {
  id: number;
  provider: RefundProvider;
  provider_transaction_id: string | null;
  payment_payload: {
    referenceNo?: string | null;
    requestId?: string | null;
    platformTradeNo?: string | null;
  } | null;
};

export type RefundRequestResult =
  | { ok: true; refund: RefundRow; mode: "auto" | "manual" }
  | { ok: false; error: string; status: number };

const REFUNDABLE_ORDER_STATUSES = new Set<PublicOrderStatus>([
  "failed",
  "success",
]);

function cleanReason(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function providerRefundKey(orderId: string, provider: RefundProvider) {
  return `refund-${provider}-${orderId}`;
}

async function loadOrderForRefund(orderId: string) {
  const [order] = await supabaseSelect<OrderRefundRow>("orders", {
    select: "id,status,final_price,paid_at,receipt_email,receipt_whatsapp",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });
  return order ?? null;
}

async function loadPaymentForRefund(orderId: string) {
  const [payment] = await supabaseSelect<PaymentRefundRow>("payments", {
    select: "id,provider,provider_transaction_id,payment_payload",
    filters: { order_id: `eq.${orderId}` },
    order: "created_at.desc",
    limit: 1,
  });
  return payment ?? null;
}

export async function getRefundForOrder(orderId: string) {
  const [refund] = await supabaseSelect<RefundRow>("refunds", {
    select: "*",
    filters: { order_id: `eq.${orderId}` },
    limit: 1,
  });
  return refund ?? null;
}

/*
 * Semua langkah SETELAH uang benar-benar kembali ke pembeli: ubah status
 * order jadi refunded (idempotent), kirim email konfirmasi, dan alert
 * Telegram untuk ops.
 *
 * Semuanya best-effort. Kegagalan salah satu langkah tidak boleh
 * menggagalkan refund — uangnya sudah keluar; yang paling buruk yang
 * terjadi hanya status order atau notifikasinya telat. Karena itu setiap
 * langkah punya try/catch sendiri dan error-nya dicatat lengkap.
 */
async function settleRefundedOrder(input: {
  orderId: string;
  orderStatus: PublicOrderStatus;
  amount: number;
  provider: RefundProvider;
  recipientEmail: string | null;
}) {
  if (input.orderStatus === "failed" || input.orderStatus === "success") {
    try {
      await markOrderRefunded(input.orderId, input.orderStatus);
    } catch (error) {
      console.error(
        `Refund order ${input.orderId} selesai, tapi status order gagal diubah menjadi refunded. Perlu pengecekan manual.`,
        error,
      );
    }
  }

  try {
    await notifyRefundProcessed({
      orderId: input.orderId,
      amount: input.amount,
      provider: input.provider,
    });
  } catch (error) {
    console.error(`Refund Telegram alert failed for order ${input.orderId}`, error);
  }

  try {
    await sendRefundCompletedEmail({
      orderId: input.orderId,
      amount: input.amount,
      recipient: input.recipientEmail,
    });
  } catch (error) {
    console.error(`Refund email failed for order ${input.orderId}`, error);
  }
}

async function sendRefundCompletedEmail(input: {
  orderId: string;
  amount: number;
  recipient: string | null;
}) {
  if (!isBrevoReceiptEnabled() || !isBrevoConfigured()) return;

  const recipient = input.recipient?.trim().toLowerCase() ?? "";
  if (!recipient) return;

  const amount = formatIDR(input.amount);
  await sendBrevoTransactionalEmail({
    to: recipient,
    subject: `Refund ${amount} untuk order ${input.orderId} sudah diproses — ${BRAND.name}`,
    htmlContent: `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f0;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 16px;font-size:18px;">Refund Anda sudah diproses</h1>
      <p style="margin:0 0 12px;line-height:1.6;">
        Hai! Refund sebesar <strong>${amount}</strong> untuk order
        <strong>${input.orderId}</strong> sudah kami kirim kembali ke metode
        pembayaran yang Anda pakai.
      </p>
      <p style="margin:0 0 12px;line-height:1.6;">
        Dana biasanya masuk mengikuti jam kerja bank/e-wallet Anda. Jika
        setelah 3&times;24 jam dana belum masuk, hubungi CS kami dan sebutkan
        nomor order di atas.
      </p>
      <p style="margin:0;line-height:1.6;">
        Terima kasih atas kesabaran Anda!
        <br />
        <strong>${BRAND.name}</strong>
      </p>
    </div>
  </body>
</html>`,
    tags: ["refund"],
  });
}

export async function requestRefundForOrder(input: {
  orderId: string;
  reason: string;
  requestedByAdminUserId?: string | null;
  requestNote?: string | null;
}): Promise<RefundRequestResult> {
  const orderId = input.orderId.trim();
  const reason = cleanReason(input.reason);

  if (!orderId) {
    return { ok: false, error: "Order ID tidak valid.", status: 400 };
  }
  if (reason.length < 3) {
    return {
      ok: false,
      error: "Alasan refund minimal 3 karakter.",
      status: 400,
    };
  }

  const order = await loadOrderForRefund(orderId);
  if (!order) {
    return { ok: false, error: "Order tidak ditemukan.", status: 404 };
  }
  if (!REFUNDABLE_ORDER_STATUSES.has(order.status)) {
    return {
      ok: false,
      error: "Order ini belum bisa di-refund otomatis.",
      status: 409,
    };
  }
  if (!order.paid_at) {
    return {
      ok: false,
      error: "Order ini belum tercatat sebagai pembayaran yang masuk.",
      status: 409,
    };
  }

  const existing = await getRefundForOrder(orderId);
  if (existing) {
    return {
      ok: false,
      error: "Order ini sudah punya permintaan refund.",
      status: 409,
    };
  }

  const payment = await loadPaymentForRefund(orderId);
  if (!payment) {
    return {
      ok: false,
      error: "Data pembayaran order ini tidak ditemukan.",
      status: 409,
    };
  }

  const provider: RefundProvider =
    payment.provider === "midtrans" || payment.provider === "doku"
      ? payment.provider
      : "manual";

  const now = new Date().toISOString();
  let refund: RefundRow | null = null;
  try {
    const inserted = await supabaseInsert<RefundRow>("refunds", {
      order_id: orderId,
      provider,
      provider_refund_id: providerRefundKey(orderId, provider),
      amount: Number(order.final_price),
      reason,
      status: "requested",
      requested_by_admin_user_id: input.requestedByAdminUserId ?? null,
      request_note: input.requestNote ?? null,
      requested_at: now,
      created_at: now,
      updated_at: now,
    });
    refund = inserted[0] ?? null;
  } catch (error) {
    /*
     * Dua request refund untuk order yang sama bisa lolos cek `existing`
     * di atas hampir bersamaan. Unique constraint `refunds.order_id`
     * yang benar-benar mencegah duplikat — pelanggarannya harus jadi
     * error yang jelas, bukan 500 mentah.
     */
    const message = error instanceof Error ? error.message : "";
    if (/duplicate key|unique constraint|23505/i.test(message)) {
      return {
        ok: false,
        error: "Order ini sudah punya permintaan refund.",
        status: 409,
      };
    }
    throw error;
  }

  if (!refund) {
    return {
      ok: false,
      error: "Permintaan refund gagal dibuat.",
      status: 502,
    };
  }

  /*
   * P3.0: beri tahu ops SEGERA saat permintaan masuk. Tanpa ini admin
   * hanya tahu kalau kebetulan membuka inspector — uang pelanggan
   * menggantung sampai ada yang melihat.
   *
   * Best-effort: kegagalan antrean alert tidak boleh menggagalkan
   * permintaan refund yang sudah tersimpan (dedupeKey meredam
   * duplikat kalau pernah terkirim).
   */
  try {
    await notifyRefundRequested({
      orderId,
      amount: Number(refund.amount),
      reason: refund.reason,
      requestedByAdmin: input.requestedByAdminUserId != null,
    });
  } catch (error) {
    console.error(
      `Refund-requested Telegram alert failed for order ${orderId}`,
      error,
    );
  }

  return {
    ok: true,
    refund,
    mode: provider === "manual" ? "manual" : "auto",
  };
}

export async function processRefundForOrder(orderId: string) {
  const refund = await getRefundForOrder(orderId);
  if (!refund) {
    return { ok: false as const, error: "Permintaan refund tidak ditemukan.", status: 404 };
  }
  if (refund.status !== "requested" && refund.status !== "failed") {
    return {
      ok: false as const,
      error: `Refund ini sudah berstatus ${refund.status}.`,
      status: 409,
    };
  }

  const now = new Date().toISOString();
  const claimed = await supabaseUpdate<RefundRow>(
    "refunds",
    {
      status: "processing",
      updated_at: now,
    },
    {
      filters: {
        order_id: `eq.${orderId}`,
        status: "in.(requested,failed)",
      },
    },
  );

  const current = claimed[0] ?? refund;
  if (claimed.length === 0 && current.status !== "processing") {
    return {
      ok: false as const,
      error: "Refund ini sedang diproses atau sudah selesai.",
      status: 409,
    };
  }

  const payment = await loadPaymentForRefund(orderId);
  const order = await loadOrderForRefund(orderId);
  if (!payment || !order) {
    await supabaseUpdate(
      "refunds",
      {
        status: "failed",
        provider_response: { error: "order-or-payment-not-found" },
        updated_at: new Date().toISOString(),
      },
      { filters: { order_id: `eq.${orderId}`, status: "eq.processing" } },
    );
    return {
      ok: false as const,
      error: "Data order atau pembayaran tidak ditemukan.",
      status: 409,
    };
  }

  if (!REFUNDABLE_ORDER_STATUSES.has(order.status)) {
    await supabaseUpdate(
      "refunds",
      {
        status: "failed",
        provider_response: { error: "order-not-refundable" },
        updated_at: new Date().toISOString(),
      },
      { filters: { order_id: `eq.${orderId}`, status: "eq.processing" } },
    );
    return {
      ok: false as const,
      error: "Order ini belum bisa di-refund otomatis.",
      status: 409,
    };
  }

  let providerResponse: Record<string, unknown>;
  try {
    if (current.provider === "midtrans") {
      const result = await refundMidtransPayment({
        orderId,
        amount: Number(current.amount),
        reason: current.reason,
        refundKey: current.provider_refund_id ?? providerRefundKey(orderId, "midtrans"),
      });
      /*
       * Fail-closed: Midtrans kadang membalas 2xx untuk kondisi yang
       * sebenarnya tidak menghasilkan refund. Tanpa refund_chargeback_id
       * tidak ada bukti refund benar-benar dibuat.
       */
      if (!result.refund_chargeback_id && !result.refund_key) {
        throw new Error(
          `Midtrans refund tidak mengembalikan refund_chargeback_id (${result.status_code ?? "?"}: ${result.status_message ?? "tanpa pesan"}).`,
        );
      }
      providerResponse = result as Record<string, unknown>;
    } else if (current.provider === "doku") {
      providerResponse = {
        raw: await refundDokuQrisPayment({
          orderId,
          referenceNo: payment.payment_payload?.referenceNo ?? payment.provider_transaction_id,
          amount: Number(current.amount),
          reason: current.reason,
          refundKey: current.provider_refund_id ?? providerRefundKey(orderId, "doku"),
        }),
      };
    } else {
      throw new Error("Refund provider ini harus dikonfirmasi manual.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refund gagal diproses.";
    await supabaseUpdate(
      "refunds",
      {
        status: "failed",
        provider_response: { error: message.slice(0, 1000) },
        updated_at: new Date().toISOString(),
      },
      { filters: { order_id: `eq.${orderId}`, status: "eq.processing" } },
    );

    return { ok: false as const, error: message, status: 502 };
  }

  /*
   * Dari titik ini refund SUDAH sukses di gateway — uang sudah keluar.
   * Langkah berikutnya tidak boleh lagi menandai refund "failed".
   */
  const completedAt = new Date().toISOString();
  const completed = await supabaseUpdate<RefundRow>(
    "refunds",
    {
      status: "completed",
      provider_response: providerResponse,
      processed_at: completedAt,
      updated_at: completedAt,
    },
    {
      filters: {
        order_id: `eq.${orderId}`,
        status: "eq.processing",
      },
    },
  );

  if (completed.length === 0) {
    return {
      ok: false as const,
      error: "Refund sudah diproses oleh request lain.",
      status: 409,
    };
  }

  await settleRefundedOrder({
    orderId,
    orderStatus: order.status,
    amount: Number(current.amount),
    provider: current.provider,
    recipientEmail: order.receipt_email,
  });

  return { ok: true as const, refund: completed[0]! };
}

/*
 * Konfirmasi admin bahwa dana BENAR-BENAR sudah keluar.
 *
 * Dua kasus yang sah:
 * 1. Provider `manual` (Paylabs) — transfer manual via Merchant Support
 *    sudah dilakukan, status apa pun selain completed/rejected boleh
 *    dikonfirmasi.
 * 2. Provider auto (Midtrans/DOKU) yang stuck di `processing` — gateway
 *    call kemungkinan sudah sukses tapi update DB gagal. Admin memverifikasi
 *    di dashboard gateway dulu, baru konfirmasi di sini.
 *
 * Refund auto yang masih `requested`/`failed` TIDAK boleh lewat sini —
 * itu harus diproses lewat tombol Refund (POST) supaya gateway call-nya
 * benar-benar terjadi.
 */
export async function confirmRefundCompletedForOrder(input: {
  orderId: string;
  confirmedByAdminUserId?: string | null;
  completedNote?: string | null;
}) {
  const refund = await getRefundForOrder(input.orderId);
  if (!refund) {
    return { ok: false as const, error: "Permintaan refund tidak ditemukan.", status: 404 };
  }
  if (refund.status === "completed") {
    return { ok: false as const, error: "Refund ini sudah selesai.", status: 409 };
  }
  if (refund.status === "rejected") {
    return { ok: false as const, error: "Refund ini sudah ditolak.", status: 409 };
  }
  if (refund.provider !== "manual" && refund.status !== "processing") {
    return {
      ok: false as const,
      error:
        "Refund gateway ini harus diproses lewat tombol Refund, atau dikonfirmasi setelah statusnya processing.",
      status: 409,
    };
  }

  const order = await loadOrderForRefund(input.orderId);
  if (!order) {
    return { ok: false as const, error: "Order tidak ditemukan.", status: 404 };
  }
  if (
    !REFUNDABLE_ORDER_STATUSES.has(order.status) &&
    order.status !== "refunded"
  ) {
    return {
      ok: false as const,
      error: "Order ini belum bisa di-refund.",
      status: 409,
    };
  }

  const now = new Date().toISOString();
  const completed = await supabaseUpdate<RefundRow>(
    "refunds",
    {
      status: "completed",
      processed_by_admin_user_id: input.confirmedByAdminUserId ?? null,
      completed_note: input.completedNote ?? null,
      processed_at: now,
      updated_at: now,
    },
    {
      filters: {
        order_id: `eq.${input.orderId}`,
        status: "in.(requested,processing,failed)",
      },
    },
  );

  if (completed.length === 0) {
    return {
      ok: false as const,
      error: "Refund ini sudah diproses atau tidak bisa diubah.",
      status: 409,
    };
  }

  await settleRefundedOrder({
    orderId: input.orderId,
    orderStatus: order.status,
    amount: Number(refund.amount),
    provider: refund.provider,
    recipientEmail: order.receipt_email,
  });

  return { ok: true as const, refund: completed[0]! };
}

export async function rejectRefundForOrder(input: {
  orderId: string;
  rejectedByAdminUserId?: string | null;
  reason: string;
}) {
  const refund = await getRefundForOrder(input.orderId);
  if (!refund) {
    return { ok: false as const, error: "Permintaan refund tidak ditemukan.", status: 404 };
  }
  if (refund.status === "completed" || refund.status === "rejected") {
    return {
      ok: false as const,
      error: "Refund ini sudah selesai atau sudah ditolak.",
      status: 409,
    };
  }

  const reason = cleanReason(input.reason);
  if (reason.length < 3) {
    return {
      ok: false as const,
      error: "Alasan penolakan minimal 3 karakter.",
      status: 400,
    };
  }

  const now = new Date().toISOString();
  const rejected = await supabaseUpdate<RefundRow>(
    "refunds",
    {
      status: "rejected",
      processed_by_admin_user_id: input.rejectedByAdminUserId ?? null,
      completed_note: reason,
      processed_at: now,
      updated_at: now,
    },
    {
      filters: {
        order_id: `eq.${input.orderId}`,
        status: "in.(requested,processing,failed)",
      },
    },
  );

  if (rejected.length === 0) {
    return {
      ok: false as const,
      error: "Refund ini sudah diproses.",
      status: 409,
    };
  }

  return { ok: true as const, refund: rejected[0]! };
}
