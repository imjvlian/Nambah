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
 */
export function readMerchantSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  return verifyMerchantSessionToken(
    readCookieValue(cookieHeader, MERCHANT_SESSION_COOKIE),
  );
}

export function merchantSessionCookie(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    `${MERCHANT_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    // `Strict`: sesi kasir tidak pernah perlu ikut pada navigasi dari situs
    // lain. Kalau cookie ikut pada request lintas origin, kasir yang
    //(summary) membuka tautan dari grup WhatsApp bisa memicu request yang
    // terotorisasi tanpa sadar.
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    secure,
  ].join("; ");
}

export function clearMerchantSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${MERCHANT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}