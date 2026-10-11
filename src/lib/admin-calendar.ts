/**
 * Logika kalender admin.
 *
 * TANPA IMPORT APA PUN - bukan React, bukan `@/lib/*`. Modul ini dipanggil
 * dari test runner `node --test` yang tidak bisa me-resolve alias Next.js,
 * dan dipakai bersama oleh dua komponen yang bentuknya berbeda:
 * rentang laporan (dua tanggal) dan jadwal promo (satu tanggal + jam).
 *
 * KENAPA MODUL TERPISAH, BUKAN DI DALAM `CalendarRangePicker.tsx`
 *
 * sebelumnya fungsi-fungsi ini hidup di dalam komponen rentang, sebagai
 * helper privat. Ketika jadwal promo butuh kalender, pilihan yang terlihat
 * mudah adalah menyalin helper-nya - dan itulah yang hampir terjadi:
 * `toKey` dan `monthMatrix` adalah tempat pergeseran tanggal satu hari
 * terjadi, dan dua salinannya pasti akan berbeda pada kasus batas.
 *
 * Format yang ditangani:
 * - `YYYY-MM-DD` untuk tanggal saja (kunci kalender, query laporan).
 * - `YYYY-MM-DDTHH:mm` untuk jadwal,|format `datetime-local` bawaan.
 *
 * KEDUA format itu dibaca sebagai waktu LOKAL, bukan UTC. Laporan keuangan
 * yang bergeser sehari jauh lebih merusak daripada satu kolom yang salah
 * hitung, dan konversi diam-diam lewat `toISOString()` adalah penyebab
 * paling umum thereof.
 */

export const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** `YYYY-MM-DD` tanpa pergeseran timezone. */
export function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parse `YYYY-MM-DD` sebagai tanggal LOKAL.
 *
 * `new Date("2026-01-31")` di-parse sebagai UTC tengah malam, lalu di
 * locale GMT+7 menjadi 31 Januari 08:00 - masih tanggal yang sama, tapi
 * di GMT-5 jadi 30 Januari. Hari yang bergeser satu hari di kalender
 * adalah cara paling cepat membuat orang salah memilih.
 */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Kunci hari ini, waktu lokal.
 *
 * Dipisah dari `toKey(new Date())` supaya bisa dipakai di server dan di
 * client tanpa perbedaan hasil - dipakai untuk menandai "hari ini" di
 * grid kalender.
 */
export function todayKey(now: Date = new Date()): string {
  return toKey(now);
}

/**
 * Validasi kunci tanggal.
 *
 * Yang diuji bukan hanya panjang string. `2026-13-45` punya bentuk yang
 * benar dan akan lolos pemeriksaan naive, lalu `fromKey` mengubahnya jadi
 * 1 Februari 2027 - tanggal yang tidak pernah diklik operator tetapi tetap
 * tersimpan kalau tidak dicegat.
 */
export function isValidKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  // Round-trip: tanggal yang di-roll over (32 Januari -> 1 Februari)
  // tidak menghasilkan kunci yang sama.
  return toKey(date) === key;
}

/** Deret hari dalam satu bulan, mulai dari hari Minggu. */
export function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  const weeks: Date[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    // Berhenti setelah minggu yang memuat tanggal 1 bulan berikutnya.
    if (cursor.getMonth() !== month && w >= 3) break;
  }
  return weeks;
}

/** Tanggal untuk manusia: `12 Januari 2026`. */
export function formatKey(key: string): string {
  if (!isValidKey(key)) return "-";
  const date = fromKey(key);
  return `${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Ringkasan rentang untuk tombol pemicu: `5 Jan - 12 Jan 2026`.
 *
 * ATURAN TAHUNNYA: tahun ditulis sekali di akhir, kecuali rentangnya
 * melintasi tahun - di situ kedua tanggal perlu tahun masing-masing.
 * "28 Des - 3 Jan 2026" dan "28 Des - 3 Jan" sangat berbeda artinya,
 * dan yang kedua bisa dibaca sebagai rentang seven hari atau satu tahun.
 *
 * Berada di sini, bukan di komponen, karena test runner tidak bisa memuat
 * `.tsx`. Logika yang perlu diuji harus bisa hidup di modul murni.
 */
export function formatRangeShort(from: string, to: string): string {
  if (!isValidKey(from) || !isValidKey(to)) return "";

  const a = fromKey(from);
  const b = fromKey(to);
  const bulanA = BULAN[a.getMonth()].slice(0, 3);
  const bulanB = BULAN[b.getMonth()].slice(0, 3);

  if (from === to) return `${a.getDate()} ${bulanA} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} ${bulanA} - ${b.getDate()} ${bulanB} ${b.getFullYear()}`;
  }
  return `${a.getDate()} ${bulanA} ${a.getFullYear()} - ${b.getDate()} ${bulanB} ${b.getFullYear()}`;
}

/* ==========================================================================
   Jadwal: tanggal + jam.
   ========================================================================== */

export type DateTimeParts = {
  /** `YYYY-MM-DD`, atau `""` saat belum diisi. */
  date: string;
  /** `"09"`, atau `""` saat belum diisi. */
  hour: string;
  /** `"30"`, atau `""` saat belum diisi. */
  minute: string;
};

/**
 * Pecah nilai `datetime-local` jadi tiga bagian terpisah.
 *
 * String yang tidak valid TIDAK dibuang diam-diam - tanggal yang tidak
 * dikenali dikembalikan kosong, karena menampilkan "--" di kalender lebih
 * jujur daripada menampilkan tanggal hasil tebakan.
 */
export function splitDateTime(value: string): DateTimeParts {
  if (!value) return { date: "", hour: "", minute: "" };

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return { date: "", hour: "", minute: "" };

  const date = match[1];
  if (!isValidKey(date)) return { date: "", hour: "", minute: "" };

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return { date, hour: "", minute: "" };

  return { date, hour: match[2], minute: match[3] };
}

/**
 * Gabungkan kembali jadi nilai `datetime-local`.
 *
 * Tanggal kosong menghasilkan string kosong - itu yang membuat "kosongkan
 * untuk langsung aktif" tetap bisa bekerja setelah memakai kalender.
 *
 * Jam kosong TIDAK menjadi string kosong. Kalau tanggal dipilih tapi jamnya
 * belum, hasilnya harus tetap berupa tanggal yang sah; mengosongkan jamnya
 * akan membuat field terbaca sebagai belum diisi dan operator berhenti
 * di tengah jalan. Defaultnya tengah hari, karena itu waktu yang paling
 * sering diinginkan untuk promo yang mulai hari ini.
 */
export function joinDateTime(parts: DateTimeParts): string {
  if (!isValidKey(parts.date)) return "";
  const hour = parts.hour === "" ? "12" : parts.hour.padStart(2, "0");
  const minute = parts.minute === "" ? "00" : parts.minute.padStart(2, "0");
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) return "";
  return `${parts.date}T${hour}:${minute}`;
}

/** Nilai jadwal untuk ditampilkan di tombol pemicu. */
export function formatDateTime(value: string): string {
  const parts = splitDateTime(value);
  if (!parts.date) return "-";
  return `${formatKey(parts.date)}, ${parts.hour || "12"}:${parts.minute || "00"}`;
}

/** Opsi jam, `00` sampai `23`. */
export const HOUR_OPTIONS: readonly string[] = Array.from(
  { length: 24 },
  (_, hour) => String(hour).padStart(2, "0"),
);

/**
 * Opsi menit, kelipatan lima.
 *
 * Lima menit sudah cukup. Menit yang ganjil membuat pemicunya jadi
 * daftar panjang yang tidak bisa dipindai sekilas, dan hampir tidak
 * pernah jadi pilihan nyata - jam promo yang dipakai di dunia nyata
 * nyaris selalu kelipatan lima.
 */
export const MINUTE_OPTIONS: readonly string[] = [
  "00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55",
];

/**
 * Bisukan jam saat tanggal dipilih.
 *
 * Tanpa ini, memilih tanggal di kalender menghasilkan nilai yang belum
 * punya jam - dan `joinDateTime` akan diam-diam memakai tengah hari.
 * Jam tengah hari untuk "mulai berlaku" hampir selalu tidak sesuai
 * keinginan: promo Treat yang dimulai jam 12 malam berjalan 12 jam
 * terlalu lama sebelum ada yang menyadarinya.
 */
export function hourForNewSchedule(time: string): string {
  const parts = splitDateTime(time);
  if (parts.hour) return parts.hour;
  return "00";
}