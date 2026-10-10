/**
 * Resolusi rentang tanggal untuk laporan.
 *
 * Dipisah dari `cash-flow.ts` karena modul latter mengimpor `server-only`
 * dan menarik Supabase. Laporan transaksi dan laporan arus kas memakai
 * definisi periode yang SAMA - kalau keduanya punya implementasi sendiri,
 * "7 hari" bisa berarti tujuh hari berbeda di dua layar, dan hasil
 * Comparing keduanya jadi tidak bermakna.
 *
 * TIDAK ADA QUERY DALAM FILE INI. File ini murni mengubah tanggal menjadi
 * rentang.
 */

export type ReportRange = { from: Date; to: Date };

/** Preset yang muncul di antarmuka, dalam urutan tampil. */
export const REPORT_PRESETS = [
  { value: "7", label: "7 hari", days: 7 },
  { value: "30", label: "30 hari", days: 30 },
  { value: "90", label: "90 hari", days: 90 },
] as const;

/**
 * Ubah preset atau rentang bebas menjadi rentang waktu konkret.
 *
 * PERILAKU PENTING: rentang yang tidak valid TIDAK menghasilkan error dan
 * TIDAK menghasilkan laporan kosong - ia jatuh ke preset. Admin yang
 * salah mengetik tanggal akan melihat laporan 30 hari terakhir, bukan
 * halaman kosong yang membuatnya mengira tidak ada transaksi.
 *
 * `to` diambil dari waktu pemanggilan (bukan argumen), supaya preset
 * "hari ini" benar-benar berakhir sekarang - bukan tengah malam UTC,
 * yang akan membuat order satu jam terakhir hilang dari laporan.
 */
export function resolveReportRange(input: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  now?: number;
}): ReportRange {
  const now = input.now ?? Date.now();

  if (input.from && input.to) {
    const from = new Date(`${input.from}T00:00:00.000Z`);
    // Ditambah 1 milidetik supaya `created_at` tepat pada ujung hari
    // ikut terambil. Tanpa itu, order yang tercatat pada 23:59:59.999
    // akan hilang dari laporan "hari ini".
    const to = new Date(`${input.to}T23:59:59.999Z`);

    if (
      Number.isFinite(from.getTime()) &&
      Number.isFinite(to.getTime()) &&
      from.getTime() <= to.getTime()
    ) {
      return { from, to };
    }
  }

  const days =
    REPORT_PRESETS.find((preset) => preset.value === input.preset)?.days ?? 30;

  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);

  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);

  return { from, to };
}

/**
 * Ubah rentang menjadi filter PostgREST.
 *
 * Dua hal yang mudah salah di sini:
 *
 * 1. Rentang harus dalam SATU kunci `and`. Dua kunci `created_at` di
 *    objek yang sama saling menimpa diam-diam, batas akhirnya hilang, dan
 *    query menarik SELURUH riwayat tanpa error apa pun.
 *
 * 2. Nilai waktu harus diapit tanda kutip. ISO-8601 mengandung `:` dan
 *    `+`, dan tanpa kutip PostgREST salah parses sebagai operator.
 */
export function rangeToFilter(range: ReportRange, column: string) {
  const exclusiveEnd = new Date(range.to.getTime() + 1).toISOString();
  return {
    and: `(${column}.gte."${range.from.toISOString()}",${column}.lt."${exclusiveEnd}")`,
  };
}