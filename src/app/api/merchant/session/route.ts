import { resolveMerchantForCode } from "@/lib/merchant-auth";
import { getMerchantById, isMerchantRetailEnabled } from "@/lib/merchant-retail";
import {
  clearMerchantSessionCookie,
  createMerchantSessionToken,
  isMerchantSessionConfigured,
  merchantSessionCookie,
  readMerchantSession,
} from "@/lib/merchant-session";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Sesi merchant: POST untuk masuk, DELETE untuk keluar, GET untuk mengecek.
 *
 * Alur ini terpisah dari `authenticateMerchant` (yang dipakai kasir per
 * pindai): kasir memerlukan kode + PIN di SETIAP request, karena perangkatnya
 * dipakai bersama dan tidak ada yang sudah masuk. Pemilik toko yang membuka
 * dashboard punya sesi sendiri, jadi tidak perlu mengetik PIN tiap kali
 * memuat halaman - dan tidak seharusnya, karena dashboard di-refresh
 * otomatis.
 *
 * PIN tidak pernah disimpan di cookie. Token hanya membawa `merchantId`.
 */

/** Berapa percobaan login sebelum dikunci sebentar. */
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 300;

export async function POST(request: Request) {
  if (!isMerchantRetailEnabled()) {
    return Response.json(
      { error: "Program toko ritel belum aktif." },
      { status: 403 },
    );
  }

  if (!isMerchantSessionConfigured()) {
    /*
     * Gagal di sini, bukan diam-diam fallback ke PIN per request. Tanpa
     * secret, sesi tidak bisa ditandatangani, dan dashboard akan terlihat
     * "berhasil login" lalu langsung logout di request berikutnya.
     */
    return Response.json(
      {
        error:
          "Sesi toko belum dikonfigurasi. Tambahkan MERCHANT_SESSION_SECRET ke environment server.",
      },
      { status: 503 },
    );
  }

  const limited = await rateLimitResponse(request, {
    scope: "merchant_login",
    limit: LOGIN_LIMIT,
    windowSeconds: LOGIN_WINDOW_SECONDS,
  });
  if (limited) return limited;

  let body: { code?: unknown; pin?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";

  if (!code || !pin) {
    return Response.json(
      { error: "Kode toko dan PIN wajib diisi." },
      { status: 400 },
    );
  }

  const merchant = await resolveMerchantForCode(code, pin);

  if (!merchant) {
    /*
     * Satu pesan untuk semua kegagalan. Memisahkan "kode tidak ada" dari
     * "PIN salah" mengubah halaman ini menjadi alat untuk menebak kode toko
     * yang aktif.
     */
    return Response.json(
      { error: "Kode toko atau PIN salah." },
      { status: 401 },
    );
  }

  /*
   * Sesi dibuat untuk SEMUA status, termasuk `pending` dan `frozen`.
   *
   *_pending_: pemilik toko yang baru daftar perlu melihat bahwa dia sedang
   *   menunggu persetujuan. Menolaknya di sini akan membuatnya mengira
   *   pendaftaran gagal.
   *
   * _frozen_: toko yang dibekukan justru yang paling perlu melihat angka
   *   piutang supaya bisa melunasi dan thawed.
   */
  const full = await getMerchantById(merchant.id);
  const session = createMerchantSessionToken(merchant.id);

  return Response.json(
    {
      merchant: {
        name: merchant.name,
        code: merchant.code,
        status: merchant.status,
        address: full?.address ?? null,
      },
    },
    { headers: { "Set-Cookie": merchantSessionCookie(session.token, session.maxAge) } },
  );
}

export async function GET(request: Request) {
  const merchantId = readMerchantSession(request);
  if (!merchantId) {
    return Response.json({ authenticated: false });
  }

  const merchant = await getMerchantById(merchantId);
  if (!merchant) {
    // Merchant dihapus sementara cookie masih hidup.
    return Response.json(
      { authenticated: false },
      { headers: { "Set-Cookie": clearMerchantSessionCookie() } },
    );
  }

  return Response.json({
    authenticated: true,
    merchant: {
      name: merchant.name,
      code: merchant.code,
      status: merchant.status,
      address: merchant.address,
    },
  });
}

export async function DELETE() {
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearMerchantSessionCookie() } },
  );
}