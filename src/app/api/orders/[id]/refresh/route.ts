import { fetchGatewayStatus, normalizeProviderId } from "@/lib/payments";
import {
  applyMidtransStatus,
  getPublicOrder,
  isOrderOwnedByUser,
} from "@/lib/order-service";
import {
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
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

    const existing = await getPublicOrder(orderId);
    if (!existing) {
      return Response.json({ error: "Order tidak ditemukan." }, { status: 404 });
    }

    // Status diambil dari gateway PEMBUAT order, bukan gateway aktif saat ini —
    // switch di dashboard tidak mengganggu order yang sedang berjalan.
    const provider = normalizeProviderId(existing.payment.provider);
    const result = await fetchGatewayStatus(provider, orderId);

    if (result.provider === "midtrans") {
      const order = await applyMidtransStatus(result.raw, "status_api", false);
      return Response.json({ order }, { headers });
    }

    return Response.json(
      { error: "Status gateway ini belum didukung." },
      { status: 501, headers },
    );
  } catch (error) {
    console.error("Payment status refresh failed", error);
    return Response.json(
      { error: "Status pembayaran belum dapat diperbarui." },
      { status: 502 },
    );
  }
}
