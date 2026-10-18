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

const MLBB_GAME_ID = "mobile-legends";

/** Label Twilight Pass — sekali per akun SELAMANYA (riset 19 Okt: bukan bulanan). */
const TWILIGHT_LABEL_PATTERN = /twilight\s*pass/i;

const PERIODIC_LABEL_PATTERN = /(weekly|monthly|mingguan|bulanan)/i;
const MONTHLY_LABEL_PATTERN = /(monthly|bulanan)/i;

/** Item periodik: satu pembelian per periode per akun. */
export function isPeriodicLabel(label: string): boolean {
  return PERIODIC_LABEL_PATTERN.test(String(label ?? ""));
}

/** Jendela riwayat untuk item periodik: mingguan 7 hari, bulanan 31. */
export function windowDaysForLabel(label: string): 7 | 31 {
  return MONTHLY_LABEL_PATTERN.test(String(label ?? "")) ? 31 : 7;
}

/**
 * Kandidat popup: pemicu lookup di frontend.
 *
 * MLBB: SELALU cek — server yang mengklasifikasi, karena item limited
 * seperti SKU event Double Diamonds ("1136 Diamond") tidak bisa dikenali
 * dari label (identitasnya ada di SKU, yang tidak terekspos ke browser).
 * Game lain: pemicu label (sekali-per-akun / periodik / Twilight Pass).
 *
 * Heuristik ini HANYA pemicu panggilan lookup — kebenaran tetap di
 * server. Salah deteksi paling parahnya satu request cache-only yang
 * terbuang.
 */
export function isLimitedPackageCandidate(
  gameId: string,
  label: string,
): boolean {
  if (gameId === MLBB_GAME_ID) return true;
  return (
    isOncePerAccountLabel(label) ||
    isPeriodicLabel(label) ||
    TWILIGHT_LABEL_PATTERN.test(label)
  );
}

/**
 * Klasifikasi item limited — sumber kebenaran tunggal untuk gate
 * checkout maupun popup.
 *
 * Prioritas: ALIAS SKU dulu (deterministik, dari data mapping nyata 19
 * Okt 2026), baru pola label (jaring untuk barang baru).
 *
 * Kelas dan sumber datanya:
 * - supplier-weekly-pass    : keluarga WDP (mlidwp / mlidwdp2d / 3d) —
 *                             data weekly_pass dari purchase-limit.
 * - supplier-double-diamonds: FTU (mlid100d-s7 = double-diamonds-50)
 *                             dan SKU event DD (mlid…dd-…) — data
 *                             double_diamonds (flag eligible + per-item).
 * - once-per-account        : FTU (scope any-purchase — top up APA PUN
 *                             menghabiskan haknya) dan Twilight Pass
 *                             (scope this-product — hanya beli paket
 *                             ini yang menghabiskannya).
 * - periodic                : weekly/monthly pack (7/31 hari) — tanpa
 *                             data supplier; riwayat Nambah satu-satunya
 *                             sumber.
 */
export type LimitedItemClass =
  | { kind: "supplier-weekly-pass" }
  | { kind: "supplier-double-diamonds"; packageCode: string | null }
  | { kind: "once-per-account"; scope: "any-purchase" | "this-product" }
  | { kind: "periodic"; windowDays: 7 | 31 };

export function classifyLimitedItem(input: {
  gameId: string;
  supplierSku: string | null;
  label: string | null;
}): LimitedItemClass | null {
  const sku = (input.supplierSku ?? "").trim().toLowerCase();
  const label = input.label ?? "";

  if (sku) {
    if (input.gameId === MLBB_GAME_ID) {
      // Keluarga WDP: varian 1x/2x/3x + kode mentah legacy.
      if (/^(weekly-pass|mlidwp|mlidwdp)/.test(sku)) {
        return { kind: "supplier-weekly-pass" };
      }
      // Kode mentah legacy double-diamonds-*.
      if (/^double-diamonds/.test(sku)) {
        return { kind: "supplier-double-diamonds", packageCode: sku };
      }
      // First Top Up 50+Bonus = 100 total (50 + bonus 50) — basis 50.
      if (/^mlid100d-/.test(sku)) {
        return {
          kind: "supplier-double-diamonds",
          packageCode: "double-diamonds-50",
        };
      }
      // SKU event Double Diamonds (mlid1136dd-s12a, mlid15dd-s12b, …):
      // hanya flag `eligible` yang bisa memverifikasi — kode paketnya
      // tidak dipublikasikan di respons.
      if (/\ddd-s\d/.test(sku)) {
        return { kind: "supplier-double-diamonds", packageCode: null };
      }
    }

    // Twilight Pass: sekali per akun selamanya.
    if (/^(mlidtp|mlgltp)/.test(sku)) {
      return { kind: "once-per-account", scope: "this-product" };
    }
    if (/^mlglwep/.test(sku)) {
      return { kind: "periodic", windowDays: 7 }; // Weekly Elite Pack
    }
    if (/^mlidemb/.test(sku)) {
      return { kind: "periodic", windowDays: 31 }; // Monthly Elite Bundle
    }
  }

  // Fallback label — barang baru yang belum ada di tabel alias.
  if (TWILIGHT_LABEL_PATTERN.test(label)) {
    return { kind: "once-per-account", scope: "this-product" };
  }
  if (isOncePerAccountLabel(label)) {
    return { kind: "once-per-account", scope: "any-purchase" };
  }
  if (isPeriodicLabel(label)) {
    return { kind: "periodic", windowDays: windowDaysForLabel(label) };
  }
  return null;
}

/** Status popup item limited — ditentukan server, dirender client. */
export type LimitPopupStatus =
  | "limit_blocked"
  | "previously-purchased"
  | "recently-purchased"
  | "consent-required"
  | "unknown";

/**
 * Set tombol per status (keputusan owner 19 Okt 2026):
 * - "single-primary" : order PASTI gagal (terverifikasi supplier atau
 *                      riwayat sekali-selamanya) — tanpa tombol lanjutkan.
 * - "cancel-continue": consent — lanjutkan adalah jawaban pembeli.
 * - "safe-continue"  : riwayat menunjukkan baru beli, tapi hari reset
 *                      periode tidak bisa dipastikan — lanjutkan tetap
 *                      tersedia sebagai tombol sekunder.
 */
export type PopupButtonSet =
  | "single-primary"
  | "cancel-continue"
  | "safe-continue";

export function popupButtonsFor(status: LimitPopupStatus): PopupButtonSet {
  switch (status) {
    case "consent-required":
      return "cancel-continue";
    case "recently-purchased":
      return "safe-continue";
    default:
      return "single-primary";
  }
}

/**
 * "3 hari lalu (Sel, 15 Okt)" — tanggal nyata supaya pengguna bisa
 * menilai sendiri apakah periode game sudah reset (jendela kita tidak
 * tahu hari reset per game).
 */
export function formatRelativeDays(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const tanggal = new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(t));
  const hari = Math.floor((Date.now() - t) / 86_400_000);
  if (hari <= 0) return `hari ini (${tanggal})`;
  if (hari === 1) return `1 hari lalu (${tanggal})`;
  if (hari < 60) return `${hari} hari lalu (${tanggal})`;
  return tanggal;
}
