import { buildMerchantDashboard } from "@/lib/merchant-dashboard";
import { resolveMerchantForCode } from "@/lib/merchant-auth";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";
import { readMerchantSession } from "@/lib/merchant-session";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Dashboard toko.
 *
 * `GET` memakai sesi cookie; `POST` (kode + PIN di body) dipakai kasir yang
 * belum punya sesi - dipakai untuk memvalidasi kredensial sebelum membuka
 * layar scan.
 *
 * Autentikasi dipakai bergantian, bukan menumpuk: kalau sesi ada, `GET`
 * memakainya dan mengabaikan body sepenuhnya. Menjalankan keduanya
 * bersamaan berarti PIN tetap_required setiap kali dashboard di-refresh,
 * yang justru yang ingin dihindari oleh chastanya sesi.
 *
 * Kasir tetap memerlukan kode + PIN di SETIAP pindai lewat
 * `/api/merchant/confirm`. Sesi dashboard tidak dipakai di sana: perangkat
 * kasir sering dipakai bersama dan tidak ada yang mengunci logout di akhir
 * shift, jadi kredensial yang melekat di perangkat lebih berisiko daripada
 * yang dietik ulang tiap pesanan.
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

/**
 * Dashboard berbasis sesi.
 *
 * Route ini yang dipakai halaman dashboard. `merchantId` datang dari cookie
 * bertanda tangan - TIDAK dari query atau body, jadi tidak ada jalan untuk
 * membaca dashboard toko lain dengan session satu.
 */
export async function GET(request: Request) {
  if (!isMerchantRetailEnabled()) {
    return Response.json({ error: "Program toko ritel belum aktif." }, { status: 403 });
  }

  const merchantId = readMerchantSession(request);
  if (!merchantId) {
    return Response.json({ error: "Belum masuk." }, { status: 401 });
  }

  const merchant = await getMerchantById(merchantId);
  if (!merchant) {
    return Response.json({ error: "Toko tidak ditemukan." }, { status: 404 });
  }

  const dashboard = await buildMerchantDashboard(
    merchant.id,
    merchant.name,
    merchant.code,
    merchant.status,
    merchant.address,
  );

  return Response.json(dashboard, {
    // Data piutang berubah setiap kali ada scan dan setiap kali admin
    // mencatat pelunasan. Tiga puluh detik cukup untuk terasa hidup tanpa
    // membebaniSupabase dengan request tiap beberapa detik.
    headers: { "Cache-Control": "private, no-store" },
  });
}