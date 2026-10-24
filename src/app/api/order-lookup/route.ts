import {
  createOrderAccessCookie,
  createOrderAccessCredential,
} from "@/lib/order-access";
import {
  ORDER_ID_PATTERN,
  ORDER_LOOKUP_MISMATCH_MESSAGE,
  orderLookupContactMatches,
} from "@/lib/order-lookup";
import { rateLimitResponse } from "@/lib/rate-limit";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Cek status order untuk tamu (P4.2): pulihkan akses dengan Order ID +
 * kontak yang diisi saat checkout.
 *
 * Berhasil verifikasi = token LAMA diganti token baru (akses lama——link
 * email lama——berhenti bekerja). Itu perilaku yang benar untuk jalur
 * "kehilangan akses": sama seperti reset kata sandi, orang yang membuktikan
 * kepemilikan dapat kunci baru, dan kunci lama ditarik.
 *
 * Penyalahgunaan ditahan dua lapis: rate limit per IP (durable, lewat RPC
 * yang sama dengan endpoint order) dan pesan galat generik yang tidak
 * membocorkan apakah ordernya ada.
 */
export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, {
    scope: "order-lookup",
    limit: 5,
    windowSeconds: 15 * 60,
  });
  if (limited) return limited;

  let body: { orderId?: unknown; contact?: unknown };
  try {
    body = (await request.json()) as { orderId?: unknown; contact?: unknown };
  } catch {
    return Response.json(
      { error: "Data pencarian tidak valid." },
      { status: 400 },
    );
  }

  const orderId =
    typeof body.orderId === "string" ? body.orderId.trim().toUpperCase() : "";
  const contact = typeof body.contact === "string" ? body.contact : "";

  if (!ORDER_ID_PATTERN.test(orderId)) {
    return Response.json(
      { error: ORDER_LOOKUP_MISMATCH_MESSAGE },
      { status: 404 },
    );
  }
  if (!contact.trim()) {
    return Response.json(
      { error: "Isi email atau WhatsApp yang Anda pakai saat checkout." },
      { status: 400 },
    );
  }

  const [order] = await supabaseSelect<{
    id: string;
    receipt_email: string | null;
    receipt_whatsapp: string | null;
  }>(
    "orders",
    {
      select: "id,receipt_email,receipt_whatsapp",
      filters: { id: `eq.${orderId}` },
      limit: 1,
    },
  );

  if (!order || !orderLookupContactMatches(contact, order)) {
    return Response.json(
      { error: ORDER_LOOKUP_MISMATCH_MESSAGE },
      { status: 404 },
    );
  }

  /*
   * Verifikasi lolos: mint kunci baru dan tarik kunci lama.
   * (Lihat komentar fungsi — ini jalur pemulihan akses, bukan duplikasi.)
   */
  const access = createOrderAccessCredential();
  await supabaseUpdate(
    "orders",
    { access_token_hash: access.tokenHash, updated_at: new Date().toISOString() },
    { filters: { id: `eq.${orderId}` } },
  );

  const headers = new Headers({ "Cache-Control": "private, no-store" });
  headers.append("Set-Cookie", createOrderAccessCookie(orderId, access.token));

  return Response.json(
    {
      orderUrl: `/order/${encodeURIComponent(orderId)}?access_token=${encodeURIComponent(access.token)}`,
    },
    { headers },
  );
}
