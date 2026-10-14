import type { MerchantStatus } from "@/lib/merchant-retail-types";

/**
 * Aturan kredit merchant — bagian MURNI, tanpa I/O.
 *
 * File ini sengaja terpisah dari `merchant-retail.ts` karena modul itu
 * mengimpor `server-only`, yang tidak bisa dimuat di test runner. Memecah
 * file berdasarkan "bisa diuji atau tidak", bukan berdasarkan "kelihatan masuk
 * akal", adalah pilihan yang tepat di sini: aturan kredit adalah inti bisnis
 * yang paling rawan salah, dan satu-satunya cara mengujinya adalah memuat
 * kodenya tanpa menarik Supabase ikut-ikutan.
 *
 * TIDAK ADA QUERY DALAM FILE INI. Kalau suatu saat butuh akses database
 * untuk keputusan, itu berarti aturan ini salah tempat — pindahkan ke
 * `merchant-retail.ts` dan biarkan test menguji bentuk finalnya di sana.
 */

/**
 * Batas piutang merchant sebelum order baru ditolak.
 *
 * NILAI INI PERLU DITINJAU ULANG SEBELUM FITUR DIJALANKAN, dan alasannya
 * spesifik: merchant BOLEH scan tanpa transfer. Artinya Lacte menanggung
 * `supplier_cost` SEJAK scan, bukan sejak pelunasan.
 *
 * Kalau hanya piutang yang sudah jadi yang dihitung, batas ini praktis
 * tidak berfungsi — semua order besar lolos dalam hitungan detik dan
 * baru ketahuan setelah semuanya sudah discan.
 */
export const MAX_RECEIVABLE_IDR = 5_000_000;

/**
 * Piutang Lacte atas satu order ritel.
 *
 * `final_price` BUKAN jumlah yang Lacte terima dari toko.
 *
 * Susunan `final_price` (lihat `pricing.ts`):
 *
 *   finalPrice = loyaltyEligibleSpend + customerPaymentFee + merchantServiceFee
 *
 * `merchantServiceFee` adalah biaya layanan yang dibayar pengguna LANGSUNG
 * ke merchant di tokonya. Uangnya tidak pernah melewati Lacte, jadi Lacte
 * tidak punya hak atasnya dan tidak boleh menagihnya ke merchant.
 *
 * Fungsi ini pernah salah di empat tempat sekaligus:
 * `getOutstandingReceivable`, `getUnappliedPaymentCredit`,
 * `getPayableInvoices` (basis alokasi FIFO), dan `merchantReceivable` di
 * laporan arus kas semuanya menjumlahkan `final_price` mentah. Akibatnya
 * merchant ditagih biaya layanan tokonya sendiri, dan karena FIFO memakai
 * angka yang sama, pelunasan yang benar justru selalu terlihat kurang.
 *
 * Kenapa satu fungsi, bukan pengurangan di tiap tempat: keempat call site
 * menghitung hal yang sama dan HARUS menghasilkan angka yang sama. Empat
 * salinan adalah empat tempat untuk menyimpang lagi.
 *
 * Hasilnya dibatasi nol: `service_fee_amount` yang lebih besar dari
 * `final_price` akan menghasilkan piutang negatif, dan piutang negatif
 * berarti Lacte berutang ke merchant - bukan yang dimaksudkan kode ini.
 */
export function merchantReceivableAmount(input: {
  finalPrice: number | string | null | undefined;
  serviceFee: number | string | null | undefined;
}) {
  const finalPrice = Number(input.finalPrice ?? 0);
  const serviceFee = Number(input.serviceFee ?? 0);

  const price = Number.isFinite(finalPrice) ? finalPrice : 0;
  const fee = Number.isFinite(serviceFee) ? serviceFee : 0;

  return Math.max(0, price - fee);
}

export type MerchantCreditInput = {
  /** Merchant-nya benar-benar ada di database. */
  found: boolean;
  status: MerchantStatus | null;
  /** Piutang yang sudah menjadi kewajiban. */
  outstanding: number;
  /** Order yang menunggu scan merchant - belum jadi utang, tapi akan jadi. */
  pending: number;
  limit?: number;
};

export type MerchantEligibility = {
  eligible: boolean;
  outstanding: number;
  pending: number;
  /** outstanding + pending. Inilah angka yang dibandingkan dengan limit. */
  committed: number;
  limit: number;
  reason: string | null;
};

/**
 * Apakah merchant boleh menerima order baru.
 *
 * Aturan yang di kunci di sini:
 *
 * 1. Merchant tidak ada / tidak aktif / beku ditolak lebih dulu, sebelum
 *    angka apa pun dilihat.
 * 2. Yang dibandingkan dengan limit adalah `committed`, BUKAN `outstanding`.
 * 3. Batas memakai `>=`: menyentuh limit berarti sudah penuh.
 */
export function evaluateMerchantCredit({
  found,
  status,
  outstanding,
  pending,
  limit = MAX_RECEIVABLE_IDR,
}: MerchantCreditInput): MerchantEligibility {
  if (!found) {
    return {
      eligible: false,
      outstanding: 0,
      pending: 0,
      committed: 0,
      limit,
      reason: "Merchant tidak ditemukan.",
    };
  }

  if (status !== "active") {
    return {
      eligible: false,
      outstanding: 0,
      pending: 0,
      committed: 0,
      limit,
      reason:
        status === "frozen"
          ? "Merchant sedang dibekukan karena ada piutang yang belum lunas."
          : "Merchant tidak aktif.",
    };
  }

  const committed = outstanding + pending;

  if (committed >= limit) {
    return {
      eligible: false,
      outstanding,
      pending,
      committed,
      limit,
      reason:
        "Kapasitas kredit merchant sudah penuh. Hubungi admin untuk pelunasan.",
    };
  }

  return {
    eligible: true,
    outstanding,
    pending,
    committed,
    limit,
    reason: null,
  };
}
