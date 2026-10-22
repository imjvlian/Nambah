import { affiliateOwnedByBuyer } from "@/lib/pricing-repository";
import { supabaseSelect } from "@/lib/supabase/server";

/**
 * Affiliate Tier 2 / upline (P2, 22 Okt 2026).
 *
 * Model (keputusan terkunci — tier2-upline-build.md):
 *   - Pohon upline = customer_profiles.referred_by_id (depth-1 saja):
 *     siapa yang mengarahkan PEMILIK KODE tier-1 saat profilnya dibuat.
 *   - Rate tier-2 = 10% dari laba bersih order — basis yang sama dengan
 *     komisi tier-1 (20%), sesuai pembagian PRD 5/20/10/65.
 *   - Snapshot tier-2 dibekukan ke orders.tier2_* saat order dibuat,
 *     mengikuti pola snapshot tier-1; commission-service membuat baris
 *     komisi kedua dari snapshot itu.
 *
 * Kenapa keputusan dipisah dari pembungkus DB: guard-nya (B1/B2/B5)
 * adalah kebijakan uang — semuanya harus bisa diuji tanpa database.
 */

/** Rate tier-2 default (B4) — configurable lewat app_settings. */
export const DEFAULT_AFFILIATE_TIER2_RATE = 0.1;

/** Kunci app_settings untuk rate tier-2 (B4). */
export const AFFILIATE_TIER2_RATE_KEY = "affiliate_tier2_rate";

/** Cookie kode affiliate yang dipasang route /r/[code] (30 hari). */
const REFERRAL_CODE_COOKIE = "nambah_ref_code";

export type Tier2Snapshot = {
  /** Kode affiliate milik UPLINE — penerima komisi tier-2. */
  code: string;
  rate: number;
  commission: number;
};

/**
 * Keputusan tier-2 untuk satu order — MURNI, tanpa database.
 *
 * Guard, urut:
 *   B2  tier-2 hanya mengikuti tier-1: tanpa kode atau tanpa komisi
 *       tier-1, tidak ada tier-2. Ini menutup minimum_order, aturan
 *       stacking, cooldown link, dan margin <= 0 sekaligus — semua
 *       kondisi itu sudah mematikan komisi tier-1 lebih dulu.
 *   D1  upline harus ada dan punya kode aktif.
 *       (pemilihan kode aktif dilakukan pembungkus DB)
 *   B5  upline ternyata pembeli order itu sendiri (login / email /
 *       WhatsApp ternormalisasi — identitas sama dengan anti
 *       self-referral P1.1/P1.2) -> tier-2 = 0, bukan 10%.
 *       Kasus nyata: A merekrut B, lalu A beli lewat kode B — tanpa
 *       guard ini A menerima 10% dari pembeliannya sendiri.
 *   B1  amount = floor(net_profit_before_affiliate * rate) — basis
 *       yang sama dengan tier-1, bukan 10% DARI komisi tier-1.
 */
export function decideTier2Commission({
  tier1Code,
  tier1Commission,
  uplineCode,
  uplineUserId,
  uplineIsBuyer,
  rate,
  netProfitBeforeAffiliate,
}: {
  tier1Code: string | null;
  tier1Commission: number;
  uplineCode: string | null;
  uplineUserId: string | null;
  uplineIsBuyer: boolean;
  rate: number;
  netProfitBeforeAffiliate: number;
}): Tier2Snapshot | null {
  // B2: tanpa komisi tier-1 tidak ada tier-2.
  if (!tier1Code || !(tier1Commission > 0)) return null;

  // D1: upline harus diketahui dan punya kode.
  if (!uplineCode || !uplineUserId) return null;

  // Jaringan rusak (upline = kode yang sama) — diam, jangan bayar.
  if (uplineCode === tier1Code) return null;

  // B5: upline = pembeli -> tier-2 = 0.
  if (uplineIsBuyer) return null;

  if (!(rate > 0)) return null;

  const commission = Math.max(0, Math.floor(netProfitBeforeAffiliate * rate));
  if (!(commission > 0)) return null;

  return { code: uplineCode, rate, commission };
}

/** Rate tier-2 dari app_settings (B4); gagal baca -> default 10%. */
export async function getAffiliateTier2Rate(): Promise<number> {
  try {
    const [row] = await supabaseSelect<{ value: unknown }>("app_settings", {
      select: "value",
      filters: { key: `eq.${AFFILIATE_TIER2_RATE_KEY}` },
      limit: 1,
    });
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? parsed
      : DEFAULT_AFFILIATE_TIER2_RATE;
  } catch {
    return DEFAULT_AFFILIATE_TIER2_RATE;
  }
}

/**
 * Pemilik user dari kode affiliate aktif.
 *
 * Kode tanpa pemilik / tidak aktif mengembalikan null — sama dengan
 * keputusan route /r/[code]: komisi yang tidak bisa dicairkan siapa pun
 * tidak boleh tercipta.
 */
export async function resolveAffiliateOwnerUserId(
  code: string,
): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  const [row] = await supabaseSelect<{ user_id: string | null }>(
    "affiliates",
    {
      select: "user_id",
      filters: { code: `eq.${normalized}`, status: "eq.active" },
      limit: 1,
    },
  );
  return row?.user_id ?? null;
}

/**
 * Snapshot tier-2 untuk satu order — dibaca di orders route SEBELUM insert.
 *
 * Hanya dijalankan saat pembuatan order (bukan preview): tier-2 tidak
 * terlihat pembeli, jadi preview tidak perlu membayar biaya lookup-nya,
 * dan identitas pembeli (email/WhatsApp kuitansi) baru lengkap di titik
 * ini — sama seperti penegakan P1.1/P1.2.
 */
export async function resolveTier2ForOrder({
  affiliateCode,
  tier1Commission,
  netProfitBeforeAffiliate,
  buyer,
}: {
  affiliateCode: string | null;
  tier1Commission: number;
  netProfitBeforeAffiliate: number;
  buyer: {
    userId?: string | null;
    email?: string | null;
    whatsapp?: string | null;
  };
}): Promise<Tier2Snapshot | null> {
  if (!affiliateCode || !(tier1Commission > 0)) return null;

  // Pemilik kode tier-1.
  const ownerUserId = await resolveAffiliateOwnerUserId(affiliateCode);
  if (!ownerUserId) return null;

  // Upline pemilik kode: siapa yang mengarahkan dia (D1).
  const [profile] = await supabaseSelect<{
    referred_by_id: string | null;
  }>("customer_profiles", {
    select: "referred_by_id",
    filters: { user_id: `eq.${ownerUserId}` },
    limit: 1,
  });
  const uplineUserId = profile?.referred_by_id ?? null;
  if (!uplineUserId) return null;

  // Kode aktif milik upline. user_id unik di affiliates (migrasi 024),
  // jadi paling banyak satu baris — limit 1 bentuk defensif.
  const [uplineAffiliate] = await supabaseSelect<{ code: string }>(
    "affiliates",
    {
      select: "code",
      filters: { user_id: `eq.${uplineUserId}`, status: "eq.active" },
      limit: 1,
    },
  );
  const uplineCode = uplineAffiliate?.code ?? null;
  if (!uplineCode) return null;

  // B5: upline = pembeli? (login / email / WhatsApp — P1.1/P1.2)
  const uplineIsBuyer = await affiliateOwnedByBuyer(uplineUserId, buyer);

  const rate = await getAffiliateTier2Rate();

  return decideTier2Commission({
    tier1Code: affiliateCode,
    tier1Commission,
    uplineCode,
    uplineUserId,
    uplineIsBuyer,
    rate,
    netProfitBeforeAffiliate,
  });
}

/**
 * Baca kode affiliate dari header cookie kirim-kirim browser.
 *
 * Cookie dipasang route /r/[code] (umur 30 hari) — dia ikut terkirim
 * ke PATCH /api/account/profile, jadi penyimpanan profil adalah momen
 * server pertama yang bisa menangkap "user ini datang dari link siapa".
 */
export function parseReferralCodeCookie(cookieHeader: string | null): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name === REFERRAL_CODE_COOKIE) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim()).toUpperCase();
      } catch {
        return "";
      }
    }
  }
  return "";
}

/**
 * Nilai referred_by_id yang boleh ditulis untuk profil ini.
 *
 * First-touch menang: profil yang sudah punya upline tidak pernah
 * ditimpa — mencegah afilator "merekrut ulang" member yang sudah ada
 * dengan cara membuat mereka menyimpan profil lagi.
 *
 * Mengembalikan null kalau tidak ada yang boleh ditulis: pemanggil
 * lalu tidak menyertakan kolom itu di upsert (merge-duplicates
 * mempertahankan nilai lama).
 */
export async function captureReferredByFromCookieHeader({
  cookieHeader,
  currentReferredBy,
}: {
  cookieHeader: string | null;
  currentReferredBy: string | null;
}): Promise<string | null> {
  if (currentReferredBy) return null;

  const code = parseReferralCodeCookie(cookieHeader);
  if (!code) return null;

  try {
    return await resolveAffiliateOwnerUserId(code);
  } catch {
    // Kegagalan resolusi tidak boleh menggagalkan penyimpanan profil.
    return null;
  }
}
