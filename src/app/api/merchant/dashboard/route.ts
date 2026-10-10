import { buildMerchantDashboard } from "@/lib/merchant-dashboard";
import { resolveMerchantForCode } from "@/lib/merchant-auth";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/merchant/dashboard — ringkasan piutang untuk toko yang sedang
 * memindai.
 *
 * AUTENTIKASI BERBEDA dari `/api/merchant/confirm` dan `/api/merchant/lookup`.
 *
 * Yang pertama menolak status non-`active`, karena kasir tidak boleh memindai
 * pesanan dari toko yang belum disetujui atau yang dibekukan karena menunggak.
 * Dashboard berbeda: pemilik toko yang baru mendaftar perlu melihat antrean
 * persetujuan, dan toko yang dibekukan justru yang paling perlu melihat
 * angka yang membuatnya bisa melunasi.
 *
 * Jadi autentikasinya sama persis (kode + PIN, satu pesan untuk semua
 * kegagalan), tapi aturannya lebih longgar. Yang tetap dikunci: hanya
 * kode+PIN, dan merchant_id selalu datang dari hash yang sudah diverifikasi -
 * bukan dari request.
 */
export async function POST(request: Request) {
  if (!isMerchantRetailEnabled()) {
    return Response.json(
      { error: "Program toko ritel belum aktif." },
      { status: 403 },
    );
  }

  let body: { code?: unknown; pin?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  // Batas 30/menit, sama seperti endpoint kasir. Verifikasi PIN-nya scrypt,
  // jadi tanpa rate limit endpoint ini juga jadi vektor untuk membuat server
  // terus-menerus hashing.
  const limited = await rateLimitResponse(request, {
    scope: "merchant_dashboard",
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

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
    // Satu pesan untuk semua kegagalan - memisahkan "kode tidak ada" dari
    // "PIN salah" akan mengubah halaman ini menjadi alat menebak kode toko.
    return Response.json(
      { error: "Kode toko atau PIN salah." },
      { status: 401 },
    );
  }

  const full = await getMerchantById(merchant.id);

  const dashboard = await buildMerchantDashboard(
    merchant.id,
    merchant.name,
    merchant.code,
    merchant.status,
    full?.address ?? null,
  );

  return Response.json(dashboard);
}