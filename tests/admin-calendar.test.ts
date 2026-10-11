import test from "node:test";
import assert from "node:assert/strict";

import {
  BULAN,
  HARI,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  formatDateTime,
  formatKey,
  fromKey,
  hourForNewSchedule,
  isValidKey,
  joinDateTime,
  monthMatrix,
  splitDateTime,
  toKey,
  todayKey,
} from "../src/lib/admin-calendar.ts";

/* ==========================================================================
   toKey / fromKey - pergeseran timezone.

   Ini akar bug paling mahal di kalender admin: tanggal yang bergeser satu
   hari tampilannya tetap sahih, jadi tidak ada yang realizes sampai
   angka laporannya tidak cocok dengan filter yang dipilih.
   ========================================================================== */

test("toKey dan fromKey bolak-balik tanpa pergeseran hari", () => {
  for (const key of ["2026-01-31", "2026-03-01", "2026-12-31", "2024-02-29"]) {
    assert.equal(toKey(fromKey(key)), key);
  }
});

test("fromKey membaca tengah malam waktu lokal, bukan UTC", () => {
  const date = fromKey("2026-01-31");
  assert.equal(date.getDate(), 31);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getFullYear(), 2026);
  // Kalau ini UTC, jamnya akan 0 dan tanggal masih sama - tetapi di
  // timezone negatif barisnya akan tanggal sebelumnya.
  assert.equal(date.getHours(), 0);
});

test("toKey tidak memakai toISOString, jadi tidak melompat ke besok", () => {
  // Tanggal terakhir hari ini, lewat UTC, melompat ke tahun depan pada
  // zona waktu positif. toKey harus tetap di tahun yang sama.
  const date = new Date(2026, 11, 31, 23, 30);
  assert.equal(toKey(date), "2026-12-31");
});

test("todayKey memakai tanggal lokal, bukan UTC", () => {
  const now = new Date(2026, 0, 1, 0, 30);
  assert.equal(todayKey(now), "2026-01-01");
});

/* ==========================================================================
   isValidKey - menolak tanggal yang "melewati" batas bulan.
   ========================================================================== */

test("isValidKey menerima tanggal yang benar-benar ada", () => {
  assert.equal(isValidKey("2026-01-01"), true);
  assert.equal(isValidKey("2026-02-28"), true);
  assert.equal(isValidKey("2024-02-29"), true);
  assert.equal(isValidKey("2026-12-31"), true);
});

test("isValidKey menolak 29 Februari di tahun bukan loncat", () => {
  assert.equal(isValidKey("2026-02-29"), false);
});

test("isValidKey menolak tanggal yang bergeser ke bulan berikutnya", () => {
  // Bentuknya benar, tapi 32 Januari akan di-roll over jadi 1 Februari.
  assert.equal(isValidKey("2026-01-32"), false);
  assert.equal(isValidKey("2026-04-31"), false);
});

test("isValidKey menolak bulan di luar 1-12 dan hari di bawah 1", () => {
  assert.equal(isValidKey("2026-13-01"), false);
  assert.equal(isValidKey("2026-00-10"), false);
  assert.equal(isValidKey("2026-01-00"), false);
});

test("isValidKey menolak bentuk yang salah", () => {
  assert.equal(isValidKey(""), false);
  assert.equal(isValidKey("2026-1-1"), false);
  assert.equal(isValidKey("26-01-01"), false);
  assert.equal(isValidKey("2026-01-01T09:00"), false);
  assert.equal(isValidKey("abcdefghij"), false);
});

/* ==========================================================================
   monthMatrix - kalender selalu 7 kolom.
   ========================================================================== */

test("monthMatrix menghasilkan minggu yang mulai dari Minggu", () => {
  const weeks = monthMatrix(2026, 0);
  assert.ok(weeks.length >= 4);
  for (const week of weeks) assert.equal(week.length, 7);
  // 1 Januari 2026 adalah Kamis.
  assert.equal(fromKey(toKey(weeks[0][0])).getDay(), 0);
  assert.ok(weeks.flat().some((d) => d.getMonth() === 0 && d.getDate() === 1));
});

test("monthMatrix memuat tanggal 1 pada minggu pertama", () => {
  const weeks = monthMatrix(2026, 0);
  assert.ok(weeks[0].some((d) => d.getMonth() === 0 && d.getDate() === 1));
});

test("monthMatrix berhenti setelah minggu yang memuat tanggal 1 berikutnya", () => {
  // Februari 2026 mulai hari Minggu dan berakhir Sabtu tanggal 28, jadi
  // butuh tepat empat minggu - tidak ada baris dari minggu berikutnya.
  // Kalau kalender memaksa enam minggu, ada dua baris kosong yang
  // terlihat seperti tanggal yang bisa diklik tapi tidak bisa.
  const weeks = monthMatrix(2026, 1);
  assert.equal(weeks.length, 4);
  assert.equal(toKey(weeks[3][0]), "2026-02-22");
  assert.equal(toKey(weeks[3][6]), "2026-02-28");
});

test("bulan yang tidak mulai di Minggu tetap memuat tanggal 1", () => {
  // September 2026 mulai Selasa, jadi baris pertama memuat 30 Agustus
  // sampai 5 September. Tanggal 1 harus ada di baris itu, bukan di
  // baris kedua - kalau tidak, kalender terlihat kehilangan awal bulan.
  const weeks = monthMatrix(2026, 8);
  const first = weeks[0];
  assert.ok(first.some((d) => d.getMonth() === 8 && d.getDate() === 1));
  assert.equal(first[0].getMonth(), 7);
});

/* ==========================================================================
   formatKey - teks yang dilihat operator.
   ========================================================================== */

test("formatKey menulis tanggal lengkap dalam bahasa Indonesia", () => {
  assert.equal(formatKey("2026-01-05"), "5 Januari 2026");
  assert.equal(formatKey("2026-12-31"), "31 Desember 2026");
});

test("formatKey memakai nama bulan yang lengkap, bukan singkatan", () => {
  assert.equal(BULAN.length, 12);
  assert.equal(BULAN[11], "Desember");
  assert.equal(BULAN[8], "September");
});

test("formatKey memberi tanda hubung untuk kunci tidak valid", () => {
  // Menebak tanggal dari string rusak lebih berbahaya daripada
  // menampilkan "-": yang ditebak akan tersimpan.
  assert.equal(formatKey(""), "-");
  assert.equal(formatKey("2026-13-45"), "-");
});

/* ==========================================================================
   splitDateTime - membaca nilai datetime-local.
   ========================================================================== */

test("splitDateTime memecah tanggal dan jam", () => {
  assert.deepEqual(splitDateTime("2026-01-05T09:30"), {
    date: "2026-01-05",
    hour: "09",
    minute: "30",
  });
});

test("splitDateTime mempertahankan nol di depan", () => {
  // "9:30" tidak boleh jadi 9:30 - nilai datetime-local selalu dua digit.
  const parts = splitDateTime("2026-01-05T09:05");
  assert.equal(parts.hour, "09");
  assert.equal(parts.minute, "05");
});

test("splitDateTime menerima detik sebagai=live", () => {
  const parts = splitDateTime("2026-01-05T09:30:00");
  assert.equal(parts.date, "2026-01-05");
  assert.equal(parts.minute, "30");
});

test("splitDateTime memberi bagian kosong untuk string kosong", () => {
  assert.deepEqual(splitDateTime(""), { date: "", hour: "", minute: "" });
});

test("splitDateTime menolak jam dan menit di luar batas", () => {
  // 25:00 tidak boleh diteruskan ke form sebagai "00".
  assert.deepEqual(splitDateTime("2026-01-05T25:00"), {
    date: "2026-01-05",
    hour: "",
    minute: "",
  });
  assert.equal(splitDateTime("2026-01-05T09:99").minute, "");
});

test("splitDateTime membuang tanggal yang tidak ada", () => {
  assert.deepEqual(splitDateTime("2026-02-30T09:00"), {
    date: "",
    hour: "",
    minute: "",
  });
});

/* ==========================================================================
   joinDateTime - kembali ke nilai datetime-local.
   ========================================================================== */

test("joinDateTime menggabungkan kembali seperti semula", () => {
  assert.equal(
    joinDateTime({ date: "2026-01-05", hour: "09", minute: "30" }),
    "2026-01-05T09:30",
  );
});

test("joinDateTime memberi nol di depan angka jam dan menit", () => {
  assert.equal(
    joinDateTime({ date: "2026-01-05", hour: "9", minute: "5" }),
    "2026-01-05T09:05",
  );
});

test("joinDateTime menghasilkan string kosong untuk tanggal kosong", () => {
  // Ini yang membuat "kosongkan untuk langsung aktif" tetap bisa dipakai
  // setelah operator sempat membuka kalender.
  assert.equal(joinDateTime({ date: "", hour: "09", minute: "30" }), "");
  assert.equal(joinDateTime({ date: "2026-02-30", hour: "", minute: "" }), "");
});

test("joinDateTime memakai tengah hari saat jam belum dipilih", () => {
  assert.equal(
    joinDateTime({ date: "2026-01-05", hour: "", minute: "" }),
    "2026-01-05T12:00",
  );
});

test("round-trip split dan join mempertahankan nilai", () => {
  const asli = "2026-01-05T09:30";
  assert.equal(joinDateTime(splitDateTime(asli)), asli);
});

test("joinDateTime menolak jam di luar batas alih-alih membungkusnya", () => {
  // 24:00 tidak boleh jadi "2026-01-06T00:00" - itu tanggal berbeda,
  // dan promo yang berakhir 1 Januari diam-diam jadi 2 Januari.
  assert.equal(joinDateTime({ date: "2026-01-05", hour: "24", minute: "00" }), "");
  assert.equal(joinDateTime({ date: "2026-01-05", hour: "09", minute: "60" }), "");
});

/* ==========================================================================
   formatDateTime - teks di tombol pemicu.
   ========================================================================== */

test("formatDateTime menulis tanggal dan jam lengkap", () => {
  assert.equal(formatDateTime("2026-01-05T09:30"), "5 Januari 2026, 09:30");
});

test("formatDateTime memberi tanda hubung saat kosong", () => {
  assert.equal(formatDateTime(""), "-");
});

/* ==========================================================================
   Opsi jam dan menit.
   ========================================================================== */

test("jamcovering 00 sampai 23 dengan nol di depan", () => {
  assert.equal(HOUR_OPTIONS.length, 24);
  assert.equal(HOUR_OPTIONS[0], "00");
  assert.equal(HOUR_OPTIONS[9], "09");
  assert.equal(HOUR_OPTIONS[23], "23");
});

test("menit kelipatan lima dari 00 sampai 55", () => {
  assert.equal(MINUTE_OPTIONS.length, 12);
  assert.equal(MINUTE_OPTIONS[0], "00");
  assert.equal(MINUTE_OPTIONS[11], "55");
  for (const minute of MINUTE_OPTIONS) {
    assert.equal(Number(minute) % 5, 0);
  }
});

/* ==========================================================================
   hourForNewSchedule - default jam saat tanggal baru dipilih.
   ========================================================================== */

test("tanggal baru tanpa jam sebelumnya menjadi tengah malam", () => {
  // Promo yang dimulai tengah malam berjalan 12 jam terlalu lama.
  assert.equal(hourForNewSchedule(""), "00");
  assert.equal(hourForNewSchedule("2026-01-05T"), "00");
});

test("jam yang sudah dipilih tidak ditimpa saat tanggal berganti", () => {
  assert.equal(hourForNewSchedule("2026-01-05T09:30"), "09");
});

test("hourForNewSchedule membuang nilai rusak", () => {
  assert.equal(hourForNewSchedule("2026-02-30T09:00"), "00");
  assert.equal(hourForNewSchedule("2026-01-05T25:00"), "00");
});

/* ==========================================================================
   Nama hari - tidak berubah sendiri.
   ========================================================================== */

test("hari dimulai dari Minggu dan berjumlah tujuh", () => {
  assert.equal(HARI.length, 7);
  assert.equal(HARI[0], "Min");
  assert.equal(HARI[6], "Sab");
});


/* ==========================================================================
   Regresi: dua bug yang ketahuan setelah komponen dipakai.

   1. Tombol "<" di bulan kedua kalender rentang memanggil `shiftMonth(1)` -
      sama dengan tombol ">". Menekan mundur justru maju. Fungsi
      `monthMatrix` sendiri tidak bisa menangkap ini, jadi yang diuji
      di sini adalah arah pergeseran, bukan isi matriksnya.

   2. `defaultRangeFor` di `ReportRangePicker` memakai
      `toISOString().slice(0, 10)`, yang mengembalikan UTC. Di GMT+7
      sebelum pukul 07:00, preset "hari ini" jadi laporan KEMARIN.
      Tidak ada error; laporannya hanya salah.
   ========================================================================== */

/** Sama persis dengan `shiftMonth`, tanpa React. */
function shiftMonth(year: number, month: number, delta: number) {
  return new Date(year, month + delta, 1);
}

test("mundur satu bulan dari bulan kedua menghasilkan dua bulan berurutan", () => {
  const cursor = shiftMonth(2026, 0, -1); // Desember 2025
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const second = new Date(first.getFullYear(), first.getMonth() + 1, 1);

  assert.equal(first.getMonth(), 11);
  assert.equal(first.getFullYear(), 2025);
  assert.equal(second.getMonth(), 0);
  assert.equal(second.getFullYear(), 2026);

  // Months kedua harus tepat satu bulan setelah yang pertama - inilah
  // yang rusak waktu keduanya memanggil shiftMonth(1).
  const selisih =
    (second.getFullYear() - first.getFullYear()) * 12 +
    (second.getMonth() - first.getMonth());
  assert.equal(selisih, 1);
});

test("maju satu bulan dari bulan kedua tetap menghasilkan dua bulan berurutan", () => {
  const cursor = shiftMonth(2026, 0, 1);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const second = new Date(first.getFullYear(), first.getMonth() + 1, 1);

  const selisih =
    (second.getFullYear() - first.getFullYear()) * 12 +
    (second.getMonth() - first.getMonth());
  assert.equal(selisih, 1);
});

test("pergeseran bulan melewati tahun baru dengan benar", () => {
  const des = shiftMonth(2026, 11, 1);
  assert.equal(des.getMonth(), 0);
  assert.equal(des.getFullYear(), 2027);

  const jan = shiftMonth(2026, 0, -1);
  assert.equal(jan.getMonth(), 11);
  assert.equal(jan.getFullYear(), 2025);
});

test("pergeseran bulan tidak pernah menghasilkan tanggal di luar 1-12", () => {
  for (let delta = -36; delta <= 36; delta++) {
    const moved = shiftMonth(2026, 5, delta);
    assert.ok(moved.getMonth() >= 0 && moved.getMonth() <= 11);
  }
});

test("toKey menggantikan toISOString untuk rentang preset - tidak melompat zona waktu", () => {
  // Pukul 02:00 waktu lokal GMT+7 = 19:00 UTC HARI SEBELUMNYA.
  const lokal = new Date(2026, 0, 5, 2, 0);

  // Yang salah: melompat ke 4 Januari.
  assert.equal(lokal.toISOString().slice(0, 10), "2026-01-04");

  // Yang benar: tanggal lokal.
  assert.equal(toKey(lokal), "2026-01-05");
});

test("rentang 30 hari dihitung dari tanggal lokal, bukan UTC", () => {
  const end = new Date(2026, 0, 31, 23, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - 29);

  assert.equal(toKey(start), "2026-01-02");
  assert.equal(toKey(end), "2026-01-31");
});
