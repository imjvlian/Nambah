import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sesi kasir/pemilik toko.
 *
 * POLA SAMA dengan `admin-api.ts`: payload + tanda tangan HMAC, disimpan di
 * cookie HttpOnly. Bedanya hanya pada label domain-nya.
 *
 * KENAPA BUKAN PIN DI SESSIONSTORAGE
 *
 * PIN kasir adalah satu-satunya rahasia yang melindungi konter. Kalau
 * disimpan di `sessionStorage`, PIN itu bisa dibaca skrip apa pun yang
 * berhasil berjalan di halaman - termasuk lewat CSS yang disisipkan lewat
 * forms di tempat lain. Cookie HttpOnly tidak bisa dibaca JavaScript sama
 * sekali, jadi satu kelas serangan hilang tanpa menambahkompleksitas.
 *
 * KENAPA PIN TIDAK DISIMPAN DI PAYLOAD
 *
 * Token hanya membawa `merchantId` dan waktu kedaluwarsa. PIN hanya pernah
 * dipakai sekali, saatEstablish sesi dibuat, lalu tidak pernah dibaca lagi.
 * Kalau cookie-nya bocor, yang didapat adalah akses sebagai merchant itu -
 * bukan PIN yang bisa dipakai ulang di tempat lain.
 *
 * DOMAIN SEPARATION
 *
 * Label `merchant-session.v1` ikut di dalam input HMAC, bukan cuma di nama
 * variabel. Tanpa itu, sesi merchant dan sesi admin bisa saling
 * dipertukarkan - karena keduanya ditandatangani dengan secret yang
 * sama saat `MERCHANT_SESSION_SECRET` belum diatur. Label yang berbeda membuat
 * tanda tangannya selalu berbeda untuk isi yang sama.
 */

export const MERCHANT_SESSION_COOKIE = "nambah_merchant_session";

/**
 * Sesi kasir bertahan satu shift.
 *
 * Pendek supaya perangkat yang ditinggal terbuka di meja kasir tidak
 * otomatis jadi milik siapa pun yang lewat. practically berarti kasir
 * login sekali per shift, bukan sekali per pesanan.
 */
export const MERCHANT_SESSION_TTL_SECONDS = 12 * 60 * 60;

const SESSION_LABEL = "merchant-session.v1";

function sessionSecret(): string {
  // `MERCHANT_SESSION_SECRET` adalah yang benar. Fallback ke secret admin
  // hanya supaya fitur ini jalan sebelum secret khusus tersedia, dan aman
  // karena label domain di atas membuat keduanya tidak bisa ditukar.
  return (
    process.env.MERCHANT_SESSION_SECRET?.trim() ||
    process.env.NAMBAH_ADMIN_SESSION_SECRET?.trim() ||
    ""
  );
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(`${SESSION_LABEL}|${payload}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isMerchantSessionConfigured(): boolean {
  return Boolean(sessionSecret());
}

export function createMerchantSessionToken(
  merchantId: string,
  now = Date.now(),
): { token: string; maxAge: number } {
  const payload = Buffer.from(
    JSON.stringify({
      mid: merchantId,
      exp: Math.floor(now / 1000) + MERCHANT_SESSION_TTL_SECONDS,
    }),
    "utf8",
  ).toString("base64url");

  return {
    token: `${payload}.${sign(payload)}`,
    maxAge: MERCHANT_SESSION_TTL_SECONDS,
  };
}

/**
 * Baca merchantId dari cookie sesi.
 *
 * Mengembalikan `null` untuk: cookie kosong, format salah, tanda tangan
 * salah, kedaluwarsa, atau `MERCHANT_SESSION_SECRET` belum diatur. Semua
 * kegagalan itu tidak bisa dibedakan oleh pemanggil - dan memang tidak
 * perlu, karena aksi setelahnya sama: perlakukan sebagai belum login.
 */
export function verifyMerchantSessionToken(
  token: string,
  now = Date.now(),
): string | null {
  if (!token || !sessionSecret()) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(payload))) return null;

  let decoded: { mid?: unknown; exp?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof decoded.mid !== "string" || decoded.mid.length === 0) return null;
  if (typeof decoded.exp !== "number" || decoded.exp * 1000 <= now) return null;

  return decoded.mid;
}

export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string {
  if (!cookieHeader) return "";
  for (const item of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return "";
}

export function readCookieHeader(request: Request, name: string): string {
  return readCookieValue(request.headers.get("cookie"), name);
}

export function readMerchantSession(request: Request): string | null {
  return verifyMerchantSessionToken(
    readCookieHeader(request, MERCHANT_SESSION_COOKIE),
  );
}

/**
 * Untuk Server Component, yang punya `cookies()` dari `next/headers` dan tidak
 * punya objek `Request`.
 *
 * ⚠️ ARGUMENNYA NILAI COOKIE SAJA, bukan header `name=value`.
 *
 * `cookies().get(nama)?.value` mengembalikan nilai cookie apa adanya - bukan
 * baris `nama=nilai`. Memakainya sebagai header `name=value` membuat pencarian
 * nama selalu gagal dan hasilnya selalu kosong, jadi setiap halaman yang
 * butuh sesi akan mengira belum login dan mengarahkan ke form.
 */
export function readMerchantSessionFromValue(
  value: string | null | undefined,
): string | null {
  return verifyMerchantSessionToken(value ?? "");
}

export function merchantSessionCookie(token: string, maxAge: number): string {
  /*
   * `Secure` aktif di produksi.
   *
   * PERHATIAN untuk pengujian: `Secure` membuat browser menolak cookie
   * kalau situs diakses lewat `http://` pada alamat yang bukan localhost -
   * termasuk lewat IP LAN seperti `http://192.168.x.x:3000`. Gejalanya
   * persis seperti yang dilaporkan: server membalas 200, tapi cookie tidak
   * pernah tersimpan, jadi `/merchant` tetap menampilkan form.
   *
   * `MERCHANT_COOKIE_INSECURE=true` mematikan flag itu. HANYA untuk
   * pengujian lokal - jangan pernah dipakai di deploy sungguhan.
   */
  const useSecure =
    process.env.NODE_ENV === "production" &&
    process.env.MERCHANT_COOKIE_INSECURE !== "true";

  return [
    `${MERCHANT_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    /*
     * `Strict`: sesi toko tidak pernah perlu ikut pada navigasi dari situs
     * lain. Kalau cookie ikut pada request lintas origin, kasir yang
     * membuka tautan dari grup WhatsApp bisa memicu request yang sudah
     * terotorisasi tanpa sadar.
     */
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    // Perhatikan: NILAI sudah termasuk pemisah sendiri. Dulu baris ini
    // memakai `"; Secure"` lalu di-`join("; ")` di bawah, sehingga hasilnya
    // `Max-Age=43200; ; Secure` - dua pemisah berturut-turut, dan beberapa
    // parser memperlakukan sisa baris sebagai atribut bernama kosong.
    ...(useSecure ? ["Secure"] : []),
  ].join("; ");
}

export function clearMerchantSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${MERCHANT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}