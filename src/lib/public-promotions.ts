import { supabaseSelect } from "@/lib/supabase/server";

/**
 * Promo aktif untuk halaman publik /promo (P4.1, 24 Okt 2026).
 *
 * Masalah: kode promo hidup di checkout dan panel admin, tapi tidak ada
 * jalur discoverability — pelanggan hanya tahu promo kalau sudah tahu
 * kodenya dari luar. Halaman ini menampilkan promo yang SEDANG bisa
 * dipakai, dengan kode yang tinggal disalin.
 *
 * Yang diekspos sengaja hanya data publik: kode, nama, benefit, syarat
 * pemakaian. Tidak ada angka internal (jumlah pemakaian mentah,
 * timestamps baris, id admin).
 *
 * Aturan tampil sama dengan penegakan checkout (pricing-repository):
 * `active = true` + jendela waktu mencakup sekarang. Promo yang kuotanya
 * habis TETAP tampil dengan lencana "Kuota sudah habis" — pelanggan yang
 * dengar promonya dari luar mendapat jawaban, bukan teka-teki; menyembunyikan
 * justru membuatnya mencoba kode yang pasti gagal tanpa tahu kenapa.
 */

export type PublicPromotion = {
  code: string;
  name: string;
  /** "Potongan Rp1.000" / "Diskon 5% (maks Rp3.000)". */
  benefitText: string;
  minimumOrder: number;
  quotaPerUser: number | null;
  stackableWithReferral: boolean;
  /** null = tanpa batas waktu. */
  endsAt: string | null;
  /** null = kuota tak terbatas; 0 = habis. */
  remainingQuota: number | null;
  /** Cakupan produk: "all" atau daftar label (max 3) + total. */
  productScope:
    | { kind: "all" }
    | { kind: "scoped"; labels: string[]; total: number };
};

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** Teks benefit untuk kartu promo — MURNI, ter-unit-test. */
export function promotionBenefitText(
  type: "flat" | "percentage",
  value: number,
  maxDiscount: number | null,
): string {
  if (type === "flat") {
    return `Potongan ${IDR.format(value)}`;
  }
  const persen = `${value}%`.replace(".", ",");
  return maxDiscount && maxDiscount > 0
    ? `Diskon ${persen} (maks ${IDR.format(maxDiscount)})`
    : `Diskon ${persen}`;
}

/** Jendela waktu aktif — MURNI, aturan yang sama dengan checkout. */
export function isPromotionWindowActive(
  startsAt: string | null,
  endsAt: string | null,
  now: Date = new Date(),
): boolean {
  if (startsAt && new Date(startsAt).getTime() > now.getTime()) return false;
  if (endsAt && new Date(endsAt).getTime() <= now.getTime()) return false;
  return true;
}

/** Sisa kuota total — MURNI. null = tanpa kuota; 0 = habis. */
export function promotionRemainingQuota(
  quota: number | null,
  usedCount: number,
): number | null {
  if (quota === null) return null;
  return Math.max(0, quota - usedCount);
}

type PromotionRow = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number | string;
  minimum_order: number | string;
  max_discount: number | string | null;
  stackable_with_referral: boolean;
  starts_at: string | null;
  ends_at: string | null;
  quota: number | null;
  quota_per_user: number | null;
  active: boolean;
};

type TargetRow = { promotion_code: string; product_id: string };
type RedemptionRow = { promotion_code: string };
type ProductLabelRow = { id: string; label: string };

/**
 * Promo yang sedang bisa dipakai, siap dirender.
 *
 * Gagal baca database mengembalikan daftar kosong, bukan melempar:
 * halaman promo adalah etalase — kalau datanya gagal dimuat, pelanggan
 * tetap harus bisa top up, bukan disambut error di halaman marketing.
 */
export async function getActivePromotions(): Promise<PublicPromotion[]> {
  let promotions: PromotionRow[];
  let targets: TargetRow[];
  let redemptions: RedemptionRow[];

  try {
    [promotions, targets, redemptions] = await Promise.all([
      supabaseSelect<PromotionRow>("promotions", {
        select:
          "code,name,type,value,minimum_order,max_discount,stackable_with_referral,starts_at,ends_at,quota,quota_per_user,active",
        filters: { active: "eq.true" },
        order: "ends_at.asc",
        limit: 100,
      }),
      supabaseSelect<TargetRow>("promotion_products", {
        select: "promotion_code,product_id",
        limit: 5000,
      }),
      supabaseSelect<RedemptionRow>("promotion_redemptions", {
        select: "promotion_code",
        filters: { status: "in.(reserved,redeemed)" },
        limit: 20000,
      }),
    ]);
  } catch (error) {
    console.error("Public promotions lookup failed", error);
    return [];
  }

  const now = new Date();
  const live = promotions.filter((row) =>
    isPromotionWindowActive(row.starts_at, row.ends_at, now),
  );

  const useCountByCode = new Map<string, number>();
  for (const redemption of redemptions) {
    useCountByCode.set(
      redemption.promotion_code,
      (useCountByCode.get(redemption.promotion_code) ?? 0) + 1,
    );
  }
  const targetsByCode = new Map<string, string[]>();
  for (const target of targets) {
    const list = targetsByCode.get(target.promotion_code);
    if (list) list.push(target.product_id);
    else targetsByCode.set(target.promotion_code, [target.product_id]);
  }

  // Label produk untuk promo yang cakupannya spesifik. Promo tanpa target
  // berarti semua produk (aturan yang sama dengan checkout).
  const scopedProductIds = [
    ...new Set(live.flatMap((row) => targetsByCode.get(row.code) ?? [])),
  ];
  const productLabelById = new Map<string, string>();
  if (scopedProductIds.length > 0) {
    try {
      const productRows = await supabaseSelect<ProductLabelRow>("products", {
        select: "id,label",
        // PostgREST `in.()` punya batas panjang URL — promo yang mensasar
        // ratusan produk dipotong di sini; total tetap benar dari targets.
        filters: { id: `in.(${scopedProductIds.slice(0, 200).join(",")})` },
        limit: 200,
      });
      for (const product of productRows) {
        productLabelById.set(product.id, product.label);
      }
    } catch (error) {
      // Label bersifat kosmetik — gagal memuat label tidak boleh
      // menyembunyikan promo yang valid.
      console.error("Public promotions product labels failed", error);
    }
  }

  return live.map((row) => {
    const scopedIds = targetsByCode.get(row.code) ?? [];
    const productScope: PublicPromotion["productScope"] =
      scopedIds.length === 0
        ? { kind: "all" }
        : {
            kind: "scoped",
            labels: scopedIds
              .map((id) => productLabelById.get(id))
              .filter((label): label is string => Boolean(label))
              .slice(0, 3),
            total: scopedIds.length,
          };

    return {
      code: row.code,
      name: row.name,
      benefitText: promotionBenefitText(
        row.type,
        Number(row.value),
        row.max_discount === null ? null : Number(row.max_discount),
      ),
      minimumOrder: Number(row.minimum_order),
      quotaPerUser: row.quota_per_user,
      stackableWithReferral: row.stackable_with_referral,
      endsAt: row.ends_at,
      remainingQuota: promotionRemainingQuota(
        row.quota,
        useCountByCode.get(row.code) ?? 0,
      ),
      productScope,
    };
  });
}
