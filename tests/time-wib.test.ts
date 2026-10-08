import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWibDateLabel,
  previousWibDateKey,
  startOfWibDayIso,
  wibDateKey,
  wibDayWindow,
} from "../src/lib/time-wib.ts";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

test("wibDateKey: batas tengah malam WIB", () => {
  // 2026-10-08T02:00:00Z = 09:00 WIB 8 Oktober.
  assert.equal(wibDateKey("2026-10-08T02:00:00.000Z"), "2026-10-08");

  // 2026-10-07T23:00:00Z = 06:00 WIB 8 Oktober -> sudah tanggal 8, bukan 7.
  assert.equal(wibDateKey("2026-10-07T23:00:00.000Z"), "2026-10-08");

  // 2026-10-07T16:59:59Z = 23:59:59 WIB 7 Oktober -> masih tanggal 7.
  assert.equal(wibDateKey("2026-10-07T16:59:59.999Z"), "2026-10-07");

  // 2026-10-07T17:00:00Z = tepat 00:00 WIB 8 Oktober -> sudah berganti.
  assert.equal(wibDateKey("2026-10-07T17:00:00.000Z"), "2026-10-08");
});

test("wibDayWindow: batas bawah 00:00 WIB, batas atas 24 jam kemudian", () => {
  const window = wibDayWindow("2026-10-07");

  // 00:00 WIB 7 Oktober = 17:00 UTC 6 Oktober.
  assert.equal(window.start, "2026-10-06T17:00:00.000Z");
  assert.equal(window.end, "2026-10-07T17:00:00.000Z");

  const spanMs = Date.parse(window.end) - Date.parse(window.start);
  assert.equal(spanMs, 24 * 60 * 60 * 1000, "jendela harus tepat 24 jam");
});

test("wibDayWindow: jendela hari berurutan tidak tumpang tindih", () => {
  const first = wibDayWindow("2026-10-07");
  const second = wibDayWindow("2026-10-08");

  // Batas atas hari pertama harus sama dengan batas bawah hari kedua,
  // kalau tidak ada order yang terlewat atau terhitung dua kali.
  assert.equal(first.end, second.start);
});

test("wibDayWindow: jumlah hari tetap 24 jam di batas DST", () => {
  // WIB tidak punya DST, tapi ini mengunci ekspektasi: offset harus dikurangi
  // tepat satu kali, tidak dua kali.
  const window = wibDayWindow("2026-03-29");
  assert.equal(window.start, "2026-03-28T17:00:00.000Z");
  assert.equal(window.end, "2026-03-29T17:00:00.000Z");
});

test("previousWibDateKey: mundur satu hari, termasuk pergantian bulan", () => {
  assert.equal(previousWibDateKey("2026-10-08"), "2026-10-07");
  assert.equal(previousWibDateKey("2026-10-01"), "2026-09-30");
  assert.equal(previousWibDateKey("2026-03-01"), "2026-02-28");
  assert.equal(previousWibDateKey("2026-01-01"), "2025-12-31");
});

test("startOfWibDayIso cocok dengan awal jendela", () => {
  assert.equal(
    startOfWibDayIso("2026-10-07"),
    wibDayWindow("2026-10-07").start,
  );
});

test("wibDayWindow menerima tanggal eksplisit, bukan hanya Date.now", () => {
  // Menangkap regresi kalau implementasi diam-diam mulai memakai `new Date()`.
  const window = wibDayWindow("2021-01-01");
  assert.equal(window.start, "2020-12-31T17:00:00.000Z");
  assert.equal(window.end, "2021-01-01T17:00:00.000Z");

  const startMs = Date.parse(window.start) + WIB_OFFSET_MS;
  assert.equal(new Date(startMs).toISOString(), "2021-01-01T00:00:00.000Z");
});

test("formatWibDateLabel: tanggal dibaca sebagai kalender WIB", () => {
  // Kalau salah zone, hasilnya bisa "31 Des" untuk tanggal yang harusnya "1 Jan".
  assert.match(formatWibDateLabel("2026-10-07"), /7/);
  assert.match(formatWibDateLabel("2026-01-01"), /1/);
  assert.doesNotMatch(formatWibDateLabel("2026-01-01"), /31/);
});