import { applyDokuStatus } from "@/lib/order-service";
import {
  mapDokuTransactionStatus,
  verifyDokuNotificationSignature,
} from "@/lib/payments/doku";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const WEBHOOK_PATH = "/api/webhooks/doku";

type DokuNotificationBody = {
  originalPartnerReferenceNo?: string;
  originalReferenceNo?: string;
  latestTransactionStatus?: string;
  transactionStatusDesc?: string;
  paidTime?: string;
  amount?: { value?: string; currency?: string };
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

  const signatureValid = verifyDokuNotificationSignature({
    method: "POST",
    path: WEBHOOK_PATH,
    authorizationHeader: request.headers.get("authorization"),
    rawBody,
    timestamp: request.headers.get("x-timestamp"),
    signature: request.headers.get("x-signature"),
  });

  if (!signatureValid) {
    return Response.json(
      { responseCode: "4015600", responseMessage: "Signature tidak valid." },
      { status: 401 },
    );
  }

  let payload: DokuNotificationBody;
  try {
    payload = JSON.parse(rawBody) as DokuNotificationBody;
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
    console.error("DOKU webhook processing failed", error);
    // 503 supaya DOKU me-retry notifikasi sesuai kebijakan retry-nya.
    return Response.json(
      { responseCode: "5035601", responseMessage: "Webhook gagal diproses." },
      { status: 503 },
    );
  }
}
