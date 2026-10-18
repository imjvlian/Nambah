/**
 * Helper MURNI untuk UX item limited (0.9a) — Weekly Diamond Pass &
 * Double Diamonds MLBB. Tidak ada I/O supaya bisa dipakai aman di client
 * bundle maupun server.
 *
 * Sumber data selalu cache (kolom purchase_limit di account_check_cache,
 * migrasi 056) — diisi maksimal sekali per 24 jam per akun oleh cek akun
 * UI atau gate checkout. Popup/banner tidak pernah memicu cek supplier
 * baru (aturan RPM owner: 40 cek gratis/hari, dibagi gate + UI).
 */

export type PublicPurchaseLimitItem = {
  packageCode: string;
  limitReached: boolean;
};

export type PublicPurchaseLimit = {
  weeklyPass: PublicPurchaseLimitItem[];
  doubleDiamonds: PublicPurchaseLimitItem[];
  doubleDiamondsEligible: boolean | null;
};

function parseItems(value: unknown): PublicPurchaseLimitItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PublicPurchaseLimitItem[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.packageCode !== "string" || !record.packageCode) {
      return [];
    }
    return [
      {
        packageCode: record.packageCode,
        limitReached: record.limitReached === true,
      },
    ];
  });
}

/**
 * Baca ulang payload purchase-limit dari cache jsonb / response API.
 * Bentuk asing atau kosong total -> null (dianggap belum ada data).
 */
export function parsePublicPurchaseLimit(
  value: unknown,
): PublicPurchaseLimit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const weeklyPass = parseItems(record.weeklyPass);
  const doubleDiamonds = parseItems(record.doubleDiamonds);
  const doubleDiamondsEligible =
    typeof record.doubleDiamondsEligible === "boolean"
      ? record.doubleDiamondsEligible
      : null;
  if (
    weeklyPass.length === 0 &&
    doubleDiamonds.length === 0 &&
    doubleDiamondsEligible === null
  ) {
    return null;
  }
  return { weeklyPass, doubleDiamonds, doubleDiamondsEligible };
}

/**
 * Baris advisory untuk banner sukses cek akun MLBB. Akun yang masih bersih
 * tidak menghasilkan apa pun — banner tidak menulis "aman" untuk hal yang
 * memang seharusnya begitu.
 */
export function summarizePurchaseLimit(
  limit: PublicPurchaseLimit | null | undefined,
): string[] {
  if (!limit) return [];
  const lines: string[] = [];
  if (limit.weeklyPass.some((item) => item.limitReached)) {
    lines.push(
      "Weekly Diamond Pass akun ini sudah dibeli untuk periode berjalan.",
    );
  }
  if (limit.doubleDiamondsEligible === false) {
    lines.push(
      "Bonus Double Diamonds akun ini sudah diklaim untuk periode berjalan.",
    );
  }
  return lines;
}

/**
 * Keluarga label item sekali-per-akun tanpa verifikasi supplier:
 * First Top Up (MLBB dan game Moonton lain) / First Recharge (Magic Chess
 * Go Go) / varian Indonesianya. Istilah owner 18 Okt 2026: "Double Diamond
 * = first top up kalau MLBB, first recharge kalau Magic Chess Go Go" —
 * jenis item yang sama, mekanisme klaim sekali-per-akun yang sama.
 *
 * Pola ini KETAT dan tidak menyertakan WDP/Double Diamonds: item yang
 * statusnya bisa diverifikasi supplier ditangani jalur data
 * (eligible/limit_blocked), bukan consent.
 */
const ONCE_PER_ACCOUNT_LABEL_PATTERN =
  /(first\s*top\s*up|first\s*topup|first\s*recharge|first\s*purchase|top\s*up\s*pertama|topup\s*pertama|pengisian\s*pertama)/i;

export function isOncePerAccountLabel(label: string): boolean {
  return ONCE_PER_ACCOUNT_LABEL_PATTERN.test(String(label ?? ""));
}

/**
 * Kandidat popup: pemicu lookup di frontend.
 *
 * (1) Item sekali-per-akun (First Top Up / First Recharge) di game apa
 *     pun — tanpa data supplier, keputusannya jatuh ke consent pembeli.
 * (2) WDP / Double Diamonds MLBB — punya data verifikasi supplier.
 *
 * Heuristik ini HANYA pemicu panggilan lookup — kebenaran tetap di
 * server, yang mengklasifikasi ulang: eligible / limit_blocked /
 * unknown / consent-required / bukan limited. Salah deteksi paling
 * parahnya satu request cache-only yang terbuang.
 */
export function isLimitedPackageCandidate(
  gameId: string,
  label: string,
): boolean {
  if (isOncePerAccountLabel(label)) return true;
  if (gameId !== "mobile-legends") return false;
  return /(weekly|double\s*diamond|2x)/i.test(label);
}
