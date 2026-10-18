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
  "User ID game Anda tidak ditemukan. Periksa kembali User ID dan Zone/Server ID Anda, lalu coba lagi.";

export const VERIFICATION_UNAVAILABLE_MESSAGE =
  "Verifikasi akun game sedang tidak dapat dilakukan. Silakan coba lagi beberapa saat.";

export const WEEKLY_PASS_LIMIT_MESSAGE =
  "Pembelian Weekly Diamond Pass untuk akun ini sudah mencapai batas periode berjalan. Silakan coba lagi setelah batas di-reset.";

export const DOUBLE_DIAMONDS_INELIGIBLE_MESSAGE =
  "Akun Anda sudah pernah mengambil bonus Double Diamonds, sehingga pembelian paket ini tidak dapat dilanjutkan.";

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
  doubleDiamonds: ReadonlyArray<{
    packageCode: string;
    limitReached: boolean;
  }>;
  doubleDiamondsEligible: boolean | null;
}):
  | { ok: true; warn?: "sku-not-in-limit-response" }
  | { ok: false; reason: AccountVerificationLimitReason } {
  const { supplierSku, weeklyPass, doubleDiamonds, doubleDiamondsEligible } =
    input;

  // (1) Weekly pass: SKU kita ada di daftar dan limitnya tercapai.
  if (
    supplierSku &&
    weeklyPass.some(
      (item) => item.packageCode === supplierSku && item.limitReached,
    )
  ) {
    return { ok: false, reason: "weekly-pass" };
  }

  /*
   * (2) Double diamonds — HANYA untuk SKU yang memang paket Double
   * Diamonds. BUKAN blokir blanket.
   *
   * Bug 17 Okt 2026 (kasus nyata akun xeesoxee): versi pertama memblokir
   * SEMUA order MLBB saat `eligible === false`. Akun yang mencoba beli WDP
   * (weekly_pass semua false) ditolak hanya karena eligible false —
   * padahal itu status NORMAL untuk akun yang sudah klaim bonus DD
   * periode ini. Diamond biasa dan WDP tidak ada hubungannya dengan DD.
   */
  if (
    supplierSku &&
    doubleDiamonds.some((item) => item.packageCode === supplierSku)
  ) {
    const ddItem = doubleDiamonds.find(
      (item) => item.packageCode === supplierSku,
    );
    if (doubleDiamondsEligible === false || ddItem?.limitReached === true) {
      return { ok: false, reason: "double-diamonds" };
    }
  }

  // (3) SKU tidak dikenal di salah satu daftar pun: allow + warn,
  // bukan block — lubang fail-open yang wajib dipantau (readiness/log).
  if (
    supplierSku &&
    !weeklyPass.some((item) => item.packageCode === supplierSku) &&
    !doubleDiamonds.some((item) => item.packageCode === supplierSku)
  ) {
    return { ok: true, warn: "sku-not-in-limit-response" };
  }

  return { ok: true };
}

/**
 * Keputusan limit MLBB versi KELUARGA (19 Okt 2026).
 *
 * Latar: SKU katalog Melostore (mlidwp-s1, mlid100d-s7, mlid…dd-…) tidak
 * sama dengan package code respons (weekly-pass, double-diamonds-50) —
 * pencocokan langsung di decideMlbbPurchaseLimit tidak pernah aktif
 * untuk mapping nyata. Klasifikasi alias (purchase-limit-ux) menerjemahkan
 * SKU ke kelas; fungsi ini memutuskan per kelas:
 *
 * - keluarga WDP (varian 1x/2x/3d): riset 19 Okt membuktikan WDP dapat
 *   ditumpuk maksimum 10 aktif — limit tercapainya SALAH SATU kode
 *   berarti slot habis untuk semua varian.
 * - keluarga DD: flag `eligible` berlaku akun-wide (bonus sekali per
 *   periode) + cek per-item untuk kode paket yang diketahui (FTU =
 *   double-diamonds-50).
 *
 * Fail-open: data kosong/null tidak pernah memblokir — cermin perilaku
 * decideMlbbPurchaseLimit yang sudah tervalidasi kasus xeesoxee.
 */
export type MlbbSupplierLimitClass =
  | { kind: "supplier-weekly-pass" }
  | { kind: "supplier-double-diamonds"; packageCode: string | null };

export function decideMlbbLimitForClass(input: {
  cls: MlbbSupplierLimitClass;
  weeklyPass: ReadonlyArray<{ packageCode: string; limitReached: boolean }>;
  doubleDiamonds: ReadonlyArray<{
    packageCode: string;
    limitReached: boolean;
  }>;
  doubleDiamondsEligible: boolean | null;
}): { ok: true } | { ok: false; reason: AccountVerificationLimitReason } {
  if (input.cls.kind === "supplier-weekly-pass") {
    const tercapai = input.weeklyPass.find((item) => item.limitReached);
    if (tercapai) return { ok: false, reason: "weekly-pass" };
    return { ok: true };
  }

  if (input.doubleDiamondsEligible === false) {
    return { ok: false, reason: "double-diamonds" };
  }
  if (input.cls.packageCode) {
    // Hoist ke const: narrowing diskriminan tidak menembus closure callback.
    const packageCode = input.cls.packageCode;
    const item = input.doubleDiamonds.find(
      (kandidat) => kandidat.packageCode === packageCode,
    );
    if (item?.limitReached) {
      return { ok: false, reason: "double-diamonds" };
    }
  }
  return { ok: true };
}
