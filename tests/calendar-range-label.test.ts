import test from "node:test";
import assert from "node:assert/strict";

import { formatRangeShort } from "../src/lib/admin-calendar.ts";

/**
 * Ringkasan rentang di tombol pemicu.
 *
 * Ini satu-satunya teks yang selalu terlihat di laporan - panel kalender
 * hanya muncul setelah operator membukanya. Kalau ringkasan ini salah
 * atau ambigu, angka yang terlihat benar adalah angka yang salah.
 */

test("rentang satu hari ditulis sekali, bukan dua kali", () => {
  assert.equal(formatRangeShort("2026-01-05", "2026-01-05"), "5 Jan 2026");
});

test("rentang dalam satu bulan ditulis ringkas", () => {
  assert.equal(formatRangeShort("2026-01-05", "2026-01-12"), "5 Jan - 12 Jan 2026");
});

test("rentang satu tahun ditulis ringkas", () => {
  assert.equal(
    formatRangeShort("2026-01-05", "2026-06-28"),
    "5 Jan - 28 Jun 2026",
  );
});

test("rentang yang melintasi tahun baru menulis kedua tahun", () => {
  // "28 Des - 3 Jan" tanpa tahun akan ambigu: tahun berapa yang dimaksud?
  const teks = formatRangeShort("2025-12-28", "2026-01-03");
  assert.equal(teks, "28 Des 2025 - 3 Jan 2026");
  assert.ok(teks.includes("2025"));
  assert.ok(teks.includes("2026"));
});

test("nama bulan memakai singkatan yang tidak ambigu", () => {
  // "Mei" dan "Mei" hanya satu, tapi "Jun" dan "Jul" mudah tertukar
  // huruf pertamanya, jadi keduanya harus berbeda.
  const teks = formatRangeShort("2026-06-01", "2026-07-31");
  assert.ok(teks.includes("Jun"));
  assert.ok(teks.includes("Jul"));
});

test("tanggal kosong menghasilkan string kosong", () => {
  // Panel menampilkan "Pilih rentang tanggal" kalau ini kosong - bukan
  // " - " yang terlihat seperti rentang yang sudah dipilih tapi salah.
  assert.equal(formatRangeShort("", ""), "");
  assert.equal(formatRangeShort("2026-01-05", ""), "");
  assert.equal(formatRangeShort("", "2026-01-05"), "");
});

test("tanggal tidak valid tidak dihitung", () => {
  assert.equal(formatRangeShort("2026-13-45", "2026-01-05"), "");
});

test("ringkasan tidak pernah lebih panjang dari yang terbaca", () => {
  // Dipakai di dalam tombol. String yang terlalu panjang membuat tombol
  // melebar dan mendorong filter lain ke baris bawah.
  const terpanjang = formatRangeShort("2025-12-28", "2026-12-31");
  assert.ok(terpanjang.length <= 40, "terlalu panjang: " + terpanjang);
});

test("rentang satu hari tetap lebih pendek dari rentang banyak hari", () => {
  const satuHari = formatRangeShort("2026-01-05", "2026-01-05");
  const banyakHari = formatRangeShort("2026-01-05", "2026-12-31");
  assert.ok(satuHari.length < banyakHari.length);
});