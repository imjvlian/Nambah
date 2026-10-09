import { supabaseSelect, supabaseUpsert } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Link affiliate: `/r/[code]`.
 *
 * Yang dilakukan route ini:
 *   1. cek kode affiliate — harus ada, `active`, dan punya pemilik
 *   2. catat klik (sekali per sesi per kode)
 *   3. simpan kode di cookie
 *   4. arahkan ke beranda dengan katalog terisi
 *
 * ── Dua aturan yang dijaga di sini ──────────────────────────────────────
 *
 * Kode tanpa `user_id` ditolak. `CREATOR` adalah program bawaan dengan rate
 * 0.2 tapi tidak punya pemilik — kalau link-nya bisa dipakai, komisi dari
 * order itu masuk ke kode yang tidak ada yang mencairkan.
 *
 * Redirect harus selalu benar. Kalau `/r/[code]` gagal, orang yang klik link
 * affiliate melihat halaman yang salah — dan itu milik mereka, bukan
 * shareholder. Karena itu pencatatan klik dibungkus try/catch terpisah:
 * kegagalan mencatat klik TIDAK boleh menggagalkan redirect.
 *
 * Kode di cookie bukan plunder yang aman. Dia hanya prefill kolom referral;
 * validasi tetap terjadi di server saat order dibuat. Kalau cookie containing
 * kode sampai expired atau dihapus, pembeli bisa mengetik kodenya manual.
 */

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

/** Umur cookie kode affiliate, hari. */
const CODE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Umur cookie sesi. Dipakai untuk hitungan "klik 1" per orang. */
const SESSION_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const SESSION_COOKIE = "nambah_ref_sid";
const CODE_COOKIE = "nambah_ref_code";

type AffiliateRow = {
  code: string;
  display_name: string;
  status: string;
  user_id: string | null;
};

function parseCookies(header: string | null) {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) jar.set(name, decodeURIComponent(value));
  }
  return jar;
}

function randomSessionId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

/**
 * Ke mana affiliate diarahkan.
 *
 * Selalu beranda dengan katalog terisi. Tidak ada halaman per affiliate —
 * destination tidak bisa diubah dari luar, supaya `/r/[code]` tidak pernah
 * jadi vektor open redirect.
 */
function destination() {
  return new URL("/?ref=1#catalog-start", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await context.params;
  const code = (rawCode ?? "").trim().toUpperCase();

  const cookies = parseCookies(request.headers.get("cookie"));
  let sessionId = cookies.get(SESSION_COOKIE) ?? "";
  const isNewSession = !sessionId;
  if (!sessionId) sessionId = randomSessionId();

  // Kode tidak valid bentuknya: langsung arahkan ke beranda tanpa mencatat
  // apa pun. Orang yang salah ketik tidak boleh muncul di laporan.
  if (!CODE_PATTERN.test(code)) {
    return redirectResponse([
      sessionCookie(sessionId, isNewSession),
      clearCodeCookie(),
    ]);
  }

  const [affiliate] = await supabaseSelect<AffiliateRow>("affiliates", {
    select: "code,display_name,status,user_id",
    filters: { code: `eq.${code}`, status: "eq.active" },
    limit: 1,
  });

  // Tidak ada, nonaktif, atau tanpa pemilik. Semua diperlakukan sama:
  // arahkan ke beranda seperti tidak ada link-nya, tanpa memberitahu Codes
  // affiliate itu tidak berlaku — itu informasi yang tidak perlu orang luar
  // punya.
  if (!affiliate || !affiliate.user_id) {
    return redirectResponse([sessionCookie(sessionId, isNewSession), clearCodeCookie()]);
  }

  // Catat klik. Kegagalan DIBAWAH sini tidak boleh menggagalkan redirect.
  try {
    // `ignore-duplicates` + unique di (affiliate_code, session_key): klik kedua
    // dari orang yang sama tidak dihitung lagi — itulah "klik 1". Dipakai
    // `upsert` karena `insert` akan melempar error 409 yang hanya perlu
    // ditelan tanpa jejak.
    await supabaseUpsert(
      "affiliate_clicks",
      {
        affiliate_code: affiliate.code,
        session_key: sessionId,
        user_id: null,
        clicked_at: new Date().toISOString(),
      },
      {
        onConflict: "affiliate_code,session_key",
        prefer: "resolution=ignore-duplicates,return=minimal",
      },
    );
  } catch {
    // Sengaja ditelan. Redirect tetap harus jalan — orang yang klik link
    // affiliate tidak boleh melihat error karena hitungan kliknya gagal.
  }

  return redirectResponse([
    sessionCookie(sessionId, isNewSession),
    codeCookie(affiliate.code),
  ]);
}

function redirectResponse(extraCookies: string[]) {
  const headers = new Headers({
    // Redirect penuh agar `/?ref=1` tidak ikut tersimpan di history — kode
    // affiliate tidak boleh bocor lewat tombol back.
    Location: destination().toString(),
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, nofollow",
  });
  for (const cookie of extraCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function sessionCookie(sessionId: string, isNew: boolean) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ].join("; ");
}

function codeCookie(code: string) {
  return [
    `${CODE_COOKIE}=${encodeURIComponent(code)}`,
    "Path=/",
    `Max-Age=${CODE_COOKIE_MAX_AGE_SECONDS}`,
    // Boleh dibaca JavaScript: halaman utama memakainya untuk mengisi kolom
    // referral, dan tidak ada script pihak ketiga yang boleh membacanya
    // karena cookie sesi tetap HttpOnly.
    "SameSite=Lax",
    "Secure",
  ].join("; ");
}

function clearCodeCookie() {
  return [
    `${CODE_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    "Secure",
  ].join("; ");
}
