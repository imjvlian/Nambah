import { applyDokuStatus } from "@/lib/order-service";
import {
  getDokuNotificationPath,
  mapDokuCheckoutStatus,
  mapDokuTransactionStatus,
  verifyDokuNonSnapNotification,
  verifyDokuNotificationSignature,
} from "@/lib/payments/doku";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const WEBHOOK_PATH = "/api/webhooks/doku";

type SnapNotificationBody = {
  originalPartnerReferenceNo?: string;
  originalReferenceNo?: string;
  latestTransactionStatus?: string;
  transactionStatusDesc?: string;
  paidTime?: string;
  amount?: { value?: string; currency?: string };
  [key: string]: unknown;
};

type NonSnapNotificationBody = {
  order?: { invoice_number?: string; amount?: number | string };
  transaction?: {
    status?: string;
    date?: string;
    original_request_id?: string;
  };
  channel?: { id?: string };
  [key: string]: unknown;
};

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { responseCode: "5035600", responseMessage: "Database belum dikonfigurasi." },
      { status: 503 },
    );
  }

  // Raw body dipakai apa adanya untuk verifikasi signature — DOKU menandatangani
  // byte persis yang dikirimnya.
  const rawBody = await request.text();
  // Request-Target harus sama persis dengan URL yang didaftarkan di dashboard
  // DOKU — diambil dari DOKU_NOTIFICATION_URL bila diisi.
  const notificationPath = getDokuNotificationPath(WEBHOOK_PATH);

  const snapSignature = request.headers.get("x-signature");

  if (snapSignature) {
    // ---- Jalur SNAP (QRIS native) ----
    const valid = verifyDokuNotificationSignature({
      method: "POST",
      path: notificationPath,
      authorizationHeader: request.headers.get("authorization"),
      rawBody,
      timestamp: request.headers.get("x-timestamp"),
      signature: snapSignature,
    });
    if (!valid) {
      return Response.json(
        { responseCode: "4015600", responseMessage: "Signature tidak valid." },
        { status: 401 },
      );
    }

    let payload: SnapNotificationBody;
    try {
      payload = JSON.parse(rawBody) as SnapNotificationBody;
    } catch {
      return Response.json(
        { responseCode: "4005600", responseMessage: "Payload tidak valid." },
        { status: 400 },
      );
    }

    const orderId = payload.originalPartnerReferenceNo?.trim() ?? "";
    if (!orderId) {
      return Response.json(
        { responseCode: "4005601", responseMessage: "originalPartnerReferenceNo kosong." },
        { status: 400 },
      );
    }

    try {
      const order = await applyDokuStatus(
        {
          orderId,
          referenceNo: payload.originalReferenceNo ?? null,
          transactionStatus: mapDokuTransactionStatus(payload.latestTransactionStatus),
          transactionStatusDesc: payload.transactionStatusDesc ?? null,
          paidTime: payload.paidTime ?? null,
          amountValue: payload.amount?.value ?? null,
          paymentType: "qris",
          raw: payload,
        },
        "webhook",
        true,
      );
      return Response.json({
        responseCode: "2005600",
        responseMessage: "Success",
        orderId: order.id,
        status: order.status,
      });
    } catch (error) {
      console.error("DOKU SNAP webhook processing failed", error);
      return Response.json(
        { responseCode: "5035601", responseMessage: "Webhook gagal diproses." },
        { status: 503 },
      );
    }
  }

  // ---- Jalur non-SNAP (Jokul klasik: Checkout & kawan-kawannya) ----
  const nonSnapValid = verifyDokuNonSnapNotification({
    clientId: request.headers.get("client-id"),
    requestId: request.headers.get("request-id"),
    timestamp: request.headers.get("request-timestamp"),
    signature: request.headers.get("signature"),
    path: notificationPath,
    rawBody,
  });
  if (!nonSnapValid) {
    return Response.json(
      { error: "Signature DOKU tidak valid." },
      { status: 401 },
    );
  }

  let payload: NonSnapNotificationBody;
  try {
    payload = JSON.parse(rawBody) as NonSnapNotificationBody;
  } catch {
    return Response.json({ error: "Payload DOKU tidak valid." }, { status: 400 });
  }

  const orderId = payload.order?.invoice_number?.trim() ?? "";
  if (!orderId) {
    return Response.json(
      { error: "invoice_number kosong pada notifikasi DOKU." },
      { status: 400 },
    );
  }

  try {
    const order = await applyDokuStatus(
      {
        orderId,
        referenceNo: payload.transaction?.original_request_id ?? null,
        transactionStatus: mapDokuCheckoutStatus(payload.transaction?.status),
        transactionStatusDesc: payload.transaction?.status ?? null,
        paidTime: payload.transaction?.date ?? null,
        amountValue:
          payload.order?.amount != null ? String(payload.order.amount) : null,
        paymentType: payload.channel?.id ?? null,
        raw: payload,
      },
      "webhook",
      true,
    );
    return Response.json({ message: "SUCCESS", orderId: order.id, status: order.status });
  } catch (error) {
    console.error("DOKU non-SNAP webhook processing failed", error);
    // 503 supaya DOKU me-retry notifikasi sesuai kebijakan retry-nya.
    return Response.json(
      { error: "Webhook DOKU gagal diproses." },
      { status: 503 },
    );
  }
}
