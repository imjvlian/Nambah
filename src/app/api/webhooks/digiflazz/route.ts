import {
  verifyDigiflazzWebhookSignature,
  type DigiflazzWebhookPayload,
} from "@/lib/digiflazz/client";
import { supabaseInsert } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature");

  if (!verifyDigiflazzWebhookSignature(rawBody, signature)) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: DigiflazzWebhookPayload;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as DigiflazzWebhookPayload) : {};
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const eventType = request.headers.get("x-digiflazz-event") ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const transaction = payload.data;

  try {
    await supabaseInsert("supplier_webhook_events", {
      supplier_id: "digiflazz",
      event_type: eventType,
      request_ref: transaction?.ref_id ?? null,
      status: transaction?.status ?? null,
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

  return Response.json({ received: true });
}
