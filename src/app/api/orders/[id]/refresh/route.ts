import { getMidtransTransactionStatus } from "@/lib/midtrans/client";
import { applyMidtransStatus, getPublicOrder } from "@/lib/order-service";
import { readOrderAccessToken, verifyOrderAccess } from "@/lib/order-access";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Database Nambah belum dikonfigurasi." }, { status: 503 });
  }

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  try {
    const token = readOrderAccessToken(request);
    if (!token || !(await verifyOrderAccess(orderId, token))) {
      return Response.json({ error: "Akses tidak sah." }, { status: 401 });
    }

    const existing = await getPublicOrder(orderId);
    if (!existing) {
      return Response.json({ error: "Order tidak ditemukan." }, { status: 404 });
    }

    const payload = await getMidtransTransactionStatus(orderId);
    const order = await applyMidtransStatus(payload, "status_api", false);
    return Response.json({ order });
  } catch (error) {
    console.error("Midtrans status refresh failed", error);
    return Response.json(
      { error: "Status Midtrans belum dapat diperbarui." },
      { status: 502 },
    );
  }
}
