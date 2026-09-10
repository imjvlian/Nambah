import { getPublicOrder } from "@/lib/order-service";
import { verifyOrderAccess } from "@/lib/order-access";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
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

  const url = new URL(request.url);
  const token =
    request.headers.get("x-order-access-token") ??
    url.searchParams.get("access_token");

  if (!token || !verifyOrderAccess(orderId, token)) {
    return Response.json({ error: "Akses tidak sah." }, { status: 401 });
  }

  try {
    const order = await getPublicOrder(orderId);
    if (!order) {
      return Response.json({ error: "Order tidak ditemukan." }, { status: 404 });
    }
    return Response.json({ order });
  } catch (error) {
    console.error("Public order lookup failed", error);
    return Response.json({ error: "Status order tidak dapat dimuat." }, { status: 503 });
  }
}
