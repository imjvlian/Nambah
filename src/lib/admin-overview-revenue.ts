import { merchantReceivableAmount } from "@/lib/merchant-retail-rules";

/**
 * Baris order yang dipakai ringkasan admin untuk menghitung omzet.
 *
 * Empat kolom, bukan satu. Kolom `final_price` saja tidak cukup karena
 * `final_price` sudah memuat `merchantServiceFee` - biaya layanan yang
 * dibayar pengguna langsung ke merchant di tokonya, tidak pernah jadi milik
 * Lacte - dan karena order ritel yang piutangnya belum dibayar uangnya masih
 * di tangan toko.
 */
export type OverviewRevenueRow = {
  final_price: number | string | null;
  service_fee_amount: number | string | null;
  merchant_id: string | null;
  receivable_paid_at: string | null;
};

export type OverviewRevenue = {
  /** Omzet Lacte hari ini - sudah dikurangi fee toko, ritel belum dibayar tidak ikut. */
  revenueToday: number;
  /** Nominal ritel yang top up-nya sudah terkirim tapi uangnya belum masuk. */
  retailReceivableToday: number;
};

/**
 * Omzet hari ini untuk kartu ringkasan.
 *
 * Definisi ini WAJIB sama dengan laporan Arus Kas. Kalau kartu ringkasan
 * menjumlahkan `final_price` mentah sementara Arus Kas mengurangi fee toko,
 * aplikasi yang sama akan menampilkan dua angka "omzet" yang berbeda - dan
 * yang salah akan dipercaya, karena yang terlihat lebih besar.
 *
 * Order ritel yang piutangnya belum dibayar sengaja TIDAK masuk
 * `revenueToday`. Top up-nya memang sudah terkirim ke pembeli, tapi uangnya
 * belum masuk Lacte; menghitungnya sebagai omzet membuat kartu hari ini
 * terlihat sehat padahal uangnya masih di tangan toko.
 *
 * Nominal tersebut dikembalikan terpisah di `retailReceivableToday` supaya
 * operator tetap tahu ada uang yang sudah dikirim tapi belum tertagih -
 * tanpa mencampurnya ke omzet yang sudah jadi milik Lacte.
 */
export function overviewRevenue(rows: OverviewRevenueRow[]): OverviewRevenue {
  let revenueToday = 0;
  let retailReceivableToday = 0;

  for (const row of rows) {
    const amount = merchantReceivableAmount({
      finalPrice: row.final_price,
      serviceFee: row.service_fee_amount,
    });

    /*
     * Ritel yang piutangnya belum dibayar TIDAK masuk omzet. Bukan karena
     * nominalnya nol - nominalnya justru utuh, hanya belum jadi milik Lacte.
     */
    if (row.merchant_id && !row.receivable_paid_at) {
      retailReceivableToday += amount;
      continue;
    }

    revenueToday += amount;
  }

  return { revenueToday, retailReceivableToday };
}