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
 * Kandidat popup: hanya label paket MLBB yang menyerupai item limited.
 *
 * Heuristik ini HANYA pemicu panggilan lookup — kebenaran tetap di server,
 * yang mencocokkan productId dengan supplier_sku di tabel supplier_products
 * lalu mengeceknya lewat policy yang sama dengan gate checkout. Salah
 * detak paling parahnya satu request cache-only yang terbuang.
 */
export function isLimitedPackageCandidate(
  gameId: string,
  label: string,
): boolean {
  if (gameId !== "mobile-legends") return false;
  return /(weekly|double\s*diamond|2x)/i.test(label);
}
