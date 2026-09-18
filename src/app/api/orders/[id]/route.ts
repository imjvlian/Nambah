import { getPublicOrder, isOrderOwnedByUser } from "@/lib/order-service";
import {
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { readOrderAccessToken, verifyOrderAccess } from "@/lib/order-access";
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

  try {
    const token = readOrderAccessToken(request);
    let authorized = Boolean(token && (await verifyOrderAccess(orderId, token)));
    let auth = null as Awaited<ReturnType<typeof resolveNambahAuth>> | null;

    if (!authorized) {
      auth = await resolveNambahAuth(request);
      authorized = Boolean(
        auth.user && (await isOrderOwnedByUser(orderId, auth.user.id)),
      );
    }

    const headers = new Headers({ "Cache-Control": "private, no-store" });
    if (auth) appendResolvedNambahAuthCookies(headers, auth);

    if (!authorized) {
      return Response.json({ error: "Akses tidak sah." }, { status: 401, headers });
    }

    const order = await getPublicOrder(orderId);
    if (!order) {
      return Response.json({ error: "Order tidak ditemukan." }, { status: 404 });
    }
    return Response.json({ order }, { headers });
  } catch (error) {
    console.error("Public order lookup failed", error);
    return Response.json({ error: "Status order tidak dapat dimuat." }, { status: 503 });
  }
}
