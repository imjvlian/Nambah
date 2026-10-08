/**
 * Helper kalender WIB (UTC+7).
 *
 * Kenapa tidak pakai `new Date(); setHours(0,0,0,0)` seperti di
 * `admin/overview/route.ts:89`: itu memakai timezone lokal proses. Di Vercel
 * selalu UTC, di VPS bisa apa saja tergantung konfigurasi. Digest harian
 * reports "hari kemarin" — kalau batas inklusif/exklusif bergeser satu jam,
 * angka transaksi bisa masuk ke hari yang salah.
 *
 * Semua fungsi di sini mengembalikan ISO string UTC, supaya bisa langsung
 * dipakai sebagai filter PostgREST.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `YYYY-MM-DD` untuk tanggal WIB dari seekor timestamp (ms atau ISO). */
export function wibDateKey(value: number | string | Date) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const shifted = new Date(ms + WIB_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** Titik tengah hari WIB sebagai ISO UTC — batas bawah hari tersebut. */
export function startOfWibDayIso(dateKey: string) {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) - WIB_OFFSET_MS).toISOString();
}

/**
 * Rentang satu hari WIB penuh, sebagai dua ISO UTC: `[start, end)`.
 *
 * Batas atas dikecualikan supaya tidak ada order yang dihitung dua kali saat
 * digest untuk hari yang sama dijalankan ulang.
 */
export function wibDayWindow(dateKey: string) {
  const startMs = startOfWibDayIso(dateKey);
  const nextDate = new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + 24 * 60 * 60 * 1000);
  const endMs = nextDate.getTime() - WIB_OFFSET_MS;

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

/** Tanggal WIB sebelumnya dari `dateKey`. */
export function previousWibDateKey(dateKey: string) {
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`) - 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Label hari yang enak dibaca manusia, mis. "07 Okt 2026". */
export function formatWibDateLabel(dateKey: string) {
  const shifted = new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + WIB_OFFSET_MS);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(shifted);
}