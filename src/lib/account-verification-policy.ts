/**
 * Policy gerbang verifikasi akun — murni, tanpa I/O.
 *
 * Dipisah dari engine (`account-verification.ts`) supaya SELURUH matriks
 * keputusan bisa diuji tanpa network/DB. Ini bagian terpenting untuk
 * dijaga: satu baris yang salah di sini = seluruh checkout mati, atau
 * sebaliknya gate tidak memblokir apa pun.
 *
 * Matriks (keputusan owner 17 Okt 2026):
 *
 * | status         | off | log    | enforce                    |
 * |----------------|-----|--------|----------------------------|
 * | verified       | —   | allow  | allow                      |
 * | invalid        | —   | allow  | BLOCK 422                  |
 * | unavailable    | —   | allow  | BLOCK 503                  |
 * | limit_blocked  | —   | allow  | BLOCK 422 (alasan MLBB)    |
 * | not_required   | —   | allow  | allow                      |
 * | not_configured | —   | allow  | allow  (fail-open + alarm) |
 *
 * `off` tidak pernah sampai ke policy — engine skip total. Baris `off`
 * di atas hanya menegaskan bahwa tidak ada jalur yang memblokir diam-diam.
 */

export type AccountVerificationStatus =
  | "verified"
  | "invalid"
  | "unavailable"
  | "not_required"
  | "not_configured"
  | "limit_blocked"
  | "skipped";

export type AccountVerificationUnavailableReason =
  | "provider-error"
  | "rate-limited"
  | "insufficient-balance"
  | "auth";

export type AccountVerificationLimitReason = "weekly-pass" | "double-diamonds";

export type AccountVerificationProvider = "melostore" | "volsever" | "mimih";

export type AccountVerificationResult = {
  status: AccountVerificationStatus;
  provider: AccountVerificationProvider | null;
  nickname: string | null;
  region: string | null;
  /**
   * Waktu provider (atau cache) benar-benar konsultasi. Null untuk
   * skipped / not_required / not_configured — keputusan yang diambil
   * tanpa menyentuh provider mana pun.
   */
  checkedAt: string | null;
  reason?: AccountVerificationUnavailableReason;
  limitReason?: AccountVerificationLimitReason;
  alarm?: "insufficient-balance" | "not-configured" | "mapping-gap";
  /** Nama game untuk konteks alarm readiness/log — bukan untuk user. */
  gapNote?: string | null;
};

export type GateDecision =
  | { allowed: true }
  | { allowed: false; status: 422 | 503; error: string };

export const INVALID_ACCOUNT_MESSAGE =
  "User ID game kamu tidak ditemukan. Periksa kembali User ID dan Zone/Server ID kamu, lalu coba lagi.";

export const VERIFICATION_UNAVAILABLE_MESSAGE =
  "Verifikasi akun game sedang tidak bisa dilakukan. Coba lagi beberapa saat, ya.";

export const WEEKLY_PASS_LIMIT_MESSAGE =
  "Pembelian Weekly Pass untuk akun ini sudah mencapai batasnya. Coba lagi setelah batasnya di-reset oleh game.";

export const DOUBLE_DIAMONDS_INELIGIBLE_MESSAGE =
  "Akun kamu belum eligible untuk bonus Double Diamonds event ini, jadi pembeliannya tidak bisa dilanjutkan.";

export function decideAccountGate(
  result: AccountVerificationResult,
  mode: "off" | "log" | "enforce",
): GateDecision {
  if (mode !== "enforce") return { allowed: true };

  switch (result.status) {
    case "verified":
    case "not_required":
    case "not_configured":
    case "skipped":
      return { allowed: true };

    case "invalid":
      return { allowed: false, status: 422, error: INVALID_ACCOUNT_MESSAGE };

    case "unavailable":
      return {
        allowed: false,
        status: 503,
        error: VERIFICATION_UNAVAILABLE_MESSAGE,
      };

    case "limit_blocked":
      return {
        allowed: false,
        status: 422,
        error:
          result.limitReason === "double-diamonds"
            ? DOUBLE_DIAMONDS_INELIGIBLE_MESSAGE
            : WEEKLY_PASS_LIMIT_MESSAGE,
      };
  }
}

/**
 * Lapisan kedua, khusus MLBB — hasil `POST /mobile-legends/purchase-limit`.
 *
 * Melostore sengaja tidak dipanggil dua kali untuk order yang sama:
 * purchase-limit SUDAH memverifikasi nickname sekaligus mengembalikan
 * status anti-penyalahgunaan bonus. Memanggil check-nickname juga berarti
 * membayar jatah cek dua kali untuk satu order.
 *
 * Field-nya boolean — docs resmi Melostore menyatakan jangan menyimpulkan
 * batas numerik dari kegagalan, jadi tidak ada parsing angka di sini.
 *
 * SKU tidak ada di response -> allow + warn, BUKAN block. Ini lubang
 * fail-open yang wajib dipantau: kalau pemetaan SKU MLBB belum lengkap,
 * kontrol ini diam-diam tidak berfungsi. Readiness menampilkan jumlah
 * warning ini.
 */
export function decideMlbbPurchaseLimit(input: {
  supplierSku: string | null;
  weeklyPass: ReadonlyArray<{ packageCode: string; limitReached: boolean }>;
  doubleDiamondsEligible: boolean | null;
}):
  | { ok: true; warn?: "sku-not-in-limit-response" }
  | { ok: false; reason: AccountVerificationLimitReason } {
  const { supplierSku, weeklyPass, doubleDiamondsEligible } = input;

  if (
    supplierSku &&
    weeklyPass.some(
      (item) => item.packageCode === supplierSku && item.limitReached,
    )
  ) {
    return { ok: false, reason: "weekly-pass" };
  }

  if (doubleDiamondsEligible === false) {
    return { ok: false, reason: "double-diamonds" };
  }

  if (supplierSku && !weeklyPass.some((item) => item.packageCode === supplierSku)) {
    return { ok: true, warn: "sku-not-in-limit-response" };
  }

  return { ok: true };
}
