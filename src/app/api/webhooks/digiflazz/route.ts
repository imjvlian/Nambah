import {
  verifyDigiflazzWebhookSignature,
  type DigiflazzWebhookPayload,
} from "@/lib/digiflazz/client";
import { applyDigiflazzTransactionStatus } from "@/lib/digiflazz/status-service";
import { supabaseInsert } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature");

  if (!verifyDigiflazzWebhookSignature(rawBody, signature)) {
    return Response.json(
      { error: "Invalid webhook signature." },
      { status: 401 },
    );
  }

  let payload: DigiflazzWebhookPayload;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as DigiflazzWebhookPayload) : {};
  } catch {
    return Response.json(
      { error: "Invalid webhook payload." },
      { status: 400 },
    );
  }

  const eventType =
    request.headers.get("x-digiflazz-event") ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const transaction = payload.data;

  if (!transaction?.ref_id || !transaction.status) {
    return Response.json(
      { error: "Webhook transaction payload tidak lengkap." },
      { status: 400 },
    );
  }

  // Persist every verified callback first. Even ignored, duplicate, or
  // out-of-order callbacks remain auditable.
  try {
    await supabaseInsert("supplier_webhook_events", {
      supplier_id: "digiflazz",
      event_type: eventType,
      request_ref: transaction.ref_id,
      status: transaction.status,
      user_agent: userAgent,
      payload,
    });
  } catch (error) {
    console.error("Failed to persist Digiflazz webhook", error);
    return Response.json(
      { error: "Webhook diterima tetapi gagal disimpan." },
      { status: 503 },
    );
  }

  try {
    const result = await applyDigiflazzTransactionStatus(transaction);

    if (
      result.reason === "unknown_request_ref" ||
      result.reason === "unsupported_status" ||
      result.reason === "sku_mismatch" ||
      result.reason === "supplier_terminal_conflict" ||
      result.reason === "order_missing"
    ) {
      console.warn("Digiflazz callback ignored", result);
    }

    // Return 200 for a valid signed callback even when it is intentionally
    // ignored. Retrying an unknown/out-of-order event would not make it safer.
    return Response.json({
      received: true,
      applied: result.applied,
      reason: result.reason,
      requestRef: result.requestRef,
      orderId: result.orderId,
      supplierStatus: result.supplierTransactionStatus,
      orderStatus: result.orderStatus,
      receiptTriggered: result.receiptTriggered,
    });
  } catch (error) {
    console.error("Digiflazz webhook apply failed", error);
    return Response.json(
      {
        received: true,
        error: "Webhook tersimpan tetapi status supplier gagal diterapkan.",
      },
      { status: 503 },
    );
  }
}
