import {
  type MidtransStatusPayload,
  verifyMidtransNotificationSignature,
} from "@/lib/midtrans/client";
import { applyMidtransStatus } from "@/lib/order-service";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Database Nambah belum dikonfigurasi." }, { status: 503 });
  }

  let payload: MidtransStatusPayload;
  try {
    payload = (await request.json()) as MidtransStatusPayload;
  } catch {
    return Response.json({ error: "Payload Midtrans tidak valid." }, { status: 400 });
  }

  if (!verifyMidtransNotificationSignature(payload)) {
    return Response.json({ error: "Signature Midtrans tidak valid." }, { status: 401 });
  }

  try {
    const order = await applyMidtransStatus(payload, "webhook", true);
    return Response.json({ received: true, orderId: order.id, status: order.status });
  } catch (error) {
    console.error("Midtrans webhook processing failed", error);
    return Response.json(
      { error: "Webhook Midtrans gagal diproses." },
      { status: 503 },
    );
  }
}
