import { getPublicOrder } from "@/lib/order-service";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
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
