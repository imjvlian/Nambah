/**
 * Konversi waktu dari payment gateway (Midtrans/DOKU/Paylabs) ke UTC ISO.
 *
 * Bug 17 Okt 2026: `paid_at` tersimpan +7 jam karena waktu gateway (jam
 * WIB tanpa offset, mis. "2026-10-17 13:14:50" dari Midtrans
 * settlement_time) disimpan mentah ke kolom timestamptz berlabel +00.
 * Konsekuensinya matematika waktu cron (expiry sweeper, retry window,
 * deteksi order nyangkut, rekonsiliasi keuangan) meleset 7 jam.
 *
 * Aturan: kalau string SUDAH punya offset (Z / +07:00 / +0700), hormati
 * apa adanya. Kalau tidak, asumsikan WIB (+07:00) - zona yang dipakai
 * ketiga gateway untuk waktu transaksinya. Hasil selalu UTC ISO, sama
 * dengan semua timestamp lain yang dibuat server.
 */
export function gatewayTimeToUtcIso(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;

  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const withOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}+07:00`;
  const ms = Date.parse(withOffset);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
