import {
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { readOrderAccessToken, verifyOrderAccess } from "@/lib/order-access";
import { getPublicOrder, isOrderOwnedByUser } from "@/lib/order-service";
import { requestRefundForOrder, getRefundForOrder } from "@/lib/refund-service";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";

async function authorizeOrder(request: Request, orderId: string) {
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

  return { authorized, headers };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: `Database ${BRAND.shortName} belum dikonfigurasi.` },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  const auth = await authorizeOrder(request, orderId);
  if (!auth.authorized) {
    return Response.json({ error: "Akses tidak sah." }, { status: 401, headers: auth.headers });
  }

  try {
    const refund = await getRefundForOrder(orderId);

    /*
     * Jangan kembalikan baris mentahnya — payload internal gateway dan ID
     * akun admin tidak boleh sampai ke browser pembeli.
     */
    const publicRefund = refund
      ? {
          status: refund.status,
          provider: refund.provider,
          amount: Number(refund.amount),
          requestedAt: refund.requested_at,
          processedAt: refund.processed_at,
        }
      : null;

    return Response.json({ refund: publicRefund }, { headers: auth.headers });
  } catch (error) {
    console.error("Refund status lookup failed", orderId, error);
    return Response.json(
      { error: "Status refund belum dapat dibaca." },
      { status: 502 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: `Database ${BRAND.shortName} belum dikonfigurasi.` },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  const limited = await rateLimitResponse(request, {
    scope: "order-refund-request",
    limit: 3,
    windowSeconds: 60 * 60,
  });
  if (limited) return limited;

  const auth = await authorizeOrder(request, orderId);
  if (!auth.authorized) {
    return Response.json({ error: "Akses tidak sah." }, { status: 401, headers: auth.headers });
  }

  let body: { reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request refund tidak valid." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason : "";

  try {
    const order = await getPublicOrder(orderId);
    if (!order) {
      return Response.json(
        { error: "Order tidak ditemukan." },
        { status: 404, headers: auth.headers },
      );
    }

    const result = await requestRefundForOrder({
      orderId,
      reason,
      requestNote: "customer-request",
    });

    if (!result.ok) {
      return Response.json(
        { error: result.error },
        { status: result.status, headers: auth.headers },
      );
    }

    /*
     * Bentuk yang sama dengan GET dan PublicOrder.refund — tanpa alasan
     * internal, payload gateway, atau ID admin.
     */
    const publicRefund = {
      status: result.refund.status,
      provider: result.refund.provider,
      amount: Number(result.refund.amount),
      requestedAt: result.refund.requested_at,
      processedAt: result.refund.processed_at,
    };

    return Response.json(
      {
        refund: publicRefund,
        message:
          result.mode === "manual"
            ? "Permintaan refund kamu sudah kami terima dan akan diproses manual."
            : "Permintaan refund kamu sudah kami terima.",
      },
      { status: 201, headers: auth.headers },
    );
  } catch (error) {
    console.error("Refund request failed", orderId, error);
    return Response.json(
      { error: "Permintaan refund belum dapat diproses." },
      { status: 502, headers: auth.headers },
    );
  }
}
