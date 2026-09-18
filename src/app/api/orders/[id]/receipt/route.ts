import {
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import {
  readOrderAccessToken,
  verifyOrderAccess,
} from "@/lib/order-access";
import {
  getPublicOrder,
  isOrderOwnedByUser,
} from "@/lib/order-service";
import {
  deliverSuccessReceipt,
  getReceiptDeliveryStatus,
} from "@/lib/receipt-service";
import {
  isBrevoConfigured,
  isBrevoReceiptEnabled,
} from "@/lib/brevo/client";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function authorizeOrder(
  request: Request,
  orderId: string,
) {
  const token = readOrderAccessToken(request);
  let authorized = Boolean(token && (await verifyOrderAccess(orderId, token)));
  let auth = null as Awaited<ReturnType<typeof resolveNambahAuth>> | null;

  if (!authorized) {
    auth = await resolveNambahAuth(request);
    authorized = Boolean(
      auth.user && (await isOrderOwnedByUser(orderId, auth.user.id)),
    );
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store",
  });
  if (auth) appendResolvedNambahAuthCookies(headers, auth);

  return { authorized, headers };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Database Nambah belum dikonfigurasi." },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  try {
    const auth = await authorizeOrder(request, orderId);
    if (!auth.authorized) {
      return Response.json(
        { error: "Akses tidak sah." },
        { status: 401, headers: auth.headers },
      );
    }

    const order = await getPublicOrder(orderId);
    if (!order) {
      return Response.json(
        { error: "Order tidak ditemukan." },
        { status: 404, headers: auth.headers },
      );
    }

    const status = await getReceiptDeliveryStatus(orderId);
    return Response.json(
      {
        brevo: {
          enabled: isBrevoReceiptEnabled(),
          configured: isBrevoConfigured(),
        },
        receipt: status,
      },
      { headers: auth.headers },
    );
  } catch (error) {
    console.error("Receipt status lookup failed", error);
    return Response.json(
      {
        error:
          "Status receipt belum dapat dibaca. Pastikan migration receipt_deliveries sudah dijalankan.",
      },
      { status: 503 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Database Nambah belum dikonfigurasi." },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  try {
    const auth = await authorizeOrder(request, orderId);
    if (!auth.authorized) {
      return Response.json(
        { error: "Akses tidak sah." },
        { status: 401, headers: auth.headers },
      );
    }

    const order = await getPublicOrder(orderId);
    if (!order) {
      return Response.json(
        { error: "Order tidak ditemukan." },
        { status: 404, headers: auth.headers },
      );
    }

    if (order.status !== "success") {
      return Response.json(
        {
          error: "Receipt hanya dapat dikirim setelah order success.",
          orderStatus: order.status,
        },
        { status: 409, headers: auth.headers },
      );
    }

    const result = await deliverSuccessReceipt(orderId);
    const status = await getReceiptDeliveryStatus(orderId);

    return Response.json(
      {
        result,
        brevo: {
          enabled: isBrevoReceiptEnabled(),
          configured: isBrevoConfigured(),
        },
        receipt: status,
      },
      {
        status: result.status === "failed" ? 502 : 200,
        headers: auth.headers,
      },
    );
  } catch (error) {
    console.error("Receipt retry failed", error);
    return Response.json(
      {
        error:
          "Receipt belum dapat dikirim ulang. Pastikan env Brevo dan migration receipt_deliveries sudah benar.",
      },
      { status: 503 },
    );
  }
}
