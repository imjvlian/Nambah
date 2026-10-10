import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReceivableAlert,
  buildReceivableDedupeKey,
  formatIDR,
  relativeDueLabel,
  selectAlertable,
  type ReceivableAlertRow,
} from "../src/lib/merchant-receivable-alert-rules.ts";

/**
 * Susunan alert piutang merchant.
 *
 * Dua kegagalan yang paling merusak hubungan dan paling menahan uang:
 * merchant yang behave benar tapi dapat alert "terlambat", dan merchant yang
 * benar-benar terlambat tapi tidak dapat alert sama sekali.
 */

const NOW = Date.parse("2026-10-10T00:00:00.000Z");

const row = (over: Partial<ReceivableAlertRow> = {}): ReceivableAlertRow => ({
  merchantId: "m-1",
  merchantName: "Toko Uji",
  outstanding: 120_000,
  overdue: 0,
  overdueCount: 0,
  dueSoon: 0,
  dueSoonCount: 0,
  oldestDueAt: null,
  ...over,
});

test("merchant yang tidak punya masalah tidak masuk daftar alert", () => {
  const { overdue, dueSoon } = selectAlertable([row()]);
  assert.equal(overdue.length, 0);
  assert.equal(dueSoon.length, 0);
});

test("tanpa piutang terlambat, pesan tidak dibuat sama sekali", () => {
  // Cron ini jalan tiap jam. Kalau kondisi ini mengembalikan string kosong,
  // admin menerima pesan kosong setiap jam - dan Telegram tetap membalas 200
  // sehingga tidak ada yang salah sampai benar-benar ada yang protes.
  assert.equal(buildReceivableAlert([row()], NOW), null);
  assert.equal(buildReceivableAlert([], NOW), null);
});

test("merchant terlambat masuk daftar overdue", () => {
  const { overdue, dueSoon } = selectAlertable([
    row({ overdue: 120_000, overdueCount: 2, oldestDueAt: "2026-10-07T00:00:00.000Z" }),
  ]);
  assert.equal(overdue.length, 1);
  assert.equal(dueSoon.length, 0);
});

test("merchant yang segera jatuh tempo tidak masuk overdue", () => {
  // Kategori harus terpisah: merchant yang masih 2 hari dari tenggat tidak
  // boleh ditampilkan seolah sudah menunggak.
  const { overdue, dueSoon } = selectAlertable([
    row({ dueSoon: 90_000, dueSoonCount: 1 }),
  ]);
  assert.equal(overdue.length, 0);
  assert.equal(dueSoon.length, 1);
});

test("pesan berisi nama merchant, nominal, dan total", () => {
  const message = buildReceivableAlert(
    [
      row({
        merchantName: "Toko Alpha",
        outstanding: 120_000,
        overdue: 120_000,
        overdueCount: 2,
        oldestDueAt: "2026-10-07T00:00:00.000Z",
      }),
    ],
    NOW,
  );

  assert.ok(message);
  assert.match(message, /Toko Alpha/);
  assert.match(message, /Rp120\.000/);
  assert.match(message, /2 tagihan/);
  assert.match(message, /Total piutang berjalan/);
});

test("nama merchant dengan HTML di-escape", () => {
  // Nama merchant bebas diisi siapa saja, termasuk lewat pendaftaran mandiri.
  // Tanpa escape, satu nama berisi <b> bisa merusak format seluruh pesan -
  // atau menyisipkan tautan yang tidak pernah disetujui admin.
  const message = buildReceivableAlert(
    [
      row({
        merchantName: "<script>alert(1)</script>",
        overdue: 10_000,
        overdueCount: 1,
      }),
    ],
    NOW,
  );

  assert.ok(message);
  assert.ok(!message.includes("<script>"));
  assert.match(message, /&lt;script&gt;/);
});

test("overdue dan segera jatuh tempo tampil di bagian terpisah", () => {
  const message = buildReceivableAlert(
    [
      row({
        merchantId: "a",
        merchantName: "Telat",
        overdue: 50_000,
        overdueCount: 1,
      }),
      row({
        merchantId: "b",
        merchantName: "Segera",
        outstanding: 80_000,
        dueSoon: 80_000,
        dueSoonCount: 1,
      }),
    ],
    NOW,
  );

  assert.ok(message);
  assert.match(message, /Piutang lewat tenggat/);
  assert.match(message, /Segera jatuh tempo/);
  // Total mencakup keduanya - kalau hanya overdue yang dijumlahkan, admin
  // akan melihat piutang_running lebih kecil dari kenyataan.
  assert.match(message, /Total piutang berjalan: <b>Rp200\.000<\/b>/);
});

test("label tenggat relatif memakai bahasa yang bisa ditindaklanjuti", () => {
  assert.equal(relativeDueLabel("2026-10-10T00:00:00.000Z", NOW), "jatuh tempo hari ini");
  assert.equal(relativeDueLabel("2026-10-11T00:00:00.000Z", NOW), "jatuh tempo besok");
  assert.equal(relativeDueLabel("2026-10-13T00:00:00.000Z", NOW), "jatuh tempo 3 hari lagi");
  assert.equal(relativeDueLabel("2026-10-09T00:00:00.000Z", NOW), "telat 1 hari");
  assert.equal(relativeDueLabel("2026-10-07T00:00:00.000Z", NOW), "telat 3 hari");
  assert.equal(relativeDueLabel("bukan tanggal", NOW), "tidak diketahui");
});

test("dedupe key berbeda per merchant dan per jam", () => {
  const base = "2026-10-10T08:30:00.000Z";

  const a = buildReceivableDedupeKey("m-1", "overdue", base);
  const b = buildReceivableDedupeKey("m-2", "overdue", base);
  const jamBerikutnya = buildReceivableDedupeKey(
    "m-1",
    "overdue",
    "2026-10-10T09:30:00.000Z",
  );

  // Kalau kunci tidak memuat merchant id, pesan merchant kedua akan
  // ditolak sebagai duplikat dan piutangnya tidak pernah sampai ke admin.
  assert.notEqual(a, b);
  // Cron dua kali dalam jam yang sama harus menghasilkan kunci sama.
  assert.equal(a, buildReceivableDedupeKey("m-1", "overdue", base));
  // Jam berikutnya tetap boleh mengirim ulang.
  assert.notEqual(a, jamBerikutnya);
});

test("bucket overdue dan due-soon tidak saling menimpa", () => {
  const base = "2026-10-10T08:30:00.000Z";
  assert.notEqual(
    buildReceivableDedupeKey("m-1", "overdue", base),
    buildReceivableDedupeKey("m-1", "due-soon", base),
  );
});

test("formatIDR memakai pemisah ribuan Indonesia", () => {
  assert.equal(formatIDR(120_000), "Rp120.000");
  assert.equal(formatIDR(0), "Rp0");
  assert.equal(formatIDR(-50_000), "-Rp50.000");
  assert.equal(formatIDR(1234.6), "Rp1.235");
});