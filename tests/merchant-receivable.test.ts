import assert from "node:assert/strict";
import test from "node:test";

import {
  DAY_MS,
  classifyReceivables,
} from "../src/lib/merchant-receivable-rules.ts";

/**
 * Klasifikasi piutang merchant.
 *
 * Salah klasifikasi punya dua akibat yang sama buruk: merchant yang belum
 * bayar dapat alert "terlambat" dan merusak hubungan, atau merchant yang
 * benar-benar lewat tidak dapat alert sama sekali sehingga uang tertahan
 * tanpa terlihat. Karena itu batas third-party ini diuji dengan angka
 * batas yang persis, bukan hanya kasus yang jauh-jauh dari batas.
 */

const NOW = Date.parse("2026-10-10T00:00:00.000Z");

/** Tenggat yang jatuh tepat N hari dari `NOW`. */
const inDays = (days: number) =>
  new Date(NOW + days * DAY_MS).toISOString();

test("piutang yang belum jatuh tempo hanya masuk outstanding", () => {
  const result = classifyReceivables(
    [{ final_price: 50_000, receivable_due_at: inDays(7) }],
    NOW,
  );

  assert.equal(result.outstanding, 50_000);
  assert.equal(result.overdue, 0);
  assert.equal(result.overdueCount, 0);
  assert.equal(result.dueSoon, 0);
});

test("piutang yang lewat tenggat masuk overdue", () => {
  const result = classifyReceivables(
    [{ final_price: 50_000, receivable_due_at: inDays(-1) }],
    NOW,
  );

  assert.equal(result.overdue, 50_000);
  assert.equal(result.overdueCount, 1);
  assert.equal(result.dueSoon, 0);
  // Uang yang lewat tenggat TETAP outstanding. Itu bukan dua kategori
  // terpisah - overdue adalah potongan dari outstanding, dan menjadikannya
  // dua angka yang saling lepas akan membuat total tagihan kelihatan
  // lebih kecil dari kenyataan.
  assert.equal(result.outstanding, 50_000);
});

test("tepat pada batas hari ke-3 dihitung segera jatuh tempo", () => {
  /*
   * Batas yang dipakai adalah `<=` - jadi hari ke-3 PERSIS masuk
   * "segera". Merchant yang punya waktu tiga hari lagi harus diberi
   * peringatan awal, bukan baru tahu saat sudah lewat.
   */
  const result = classifyReceivables(
    [{ final_price: 20_000, receivable_due_at: inDays(3) }],
    NOW,
  );

  assert.equal(result.dueSoon, 20_000);
  assert.equal(result.dueSoonCount, 1);
  assert.equal(result.overdue, 0);
});

test("satu detik lewat batas tidak lagi segera", () => {
  const result = classifyReceivables(
    [{ final_price: 20_000, receivable_due_at: new Date(NOW + 3 * DAY_MS + 1000).toISOString() }],
    NOW,
  );

  assert.equal(result.dueSoon, 0);
  assert.equal(result.dueSoonCount, 0);
});

test("tenggat tepat di 'sekarang' masih dianggap tepat waktu", () => {
  /*
   * `receivable_due_at` adalah waktu yang diharapkan merchant membayar.
   * Pembayaran yang datang tepat di detik itu masih tepat waktu, jadi
   * `due < now` (bukan `<=`) adalah pilihan yang benar.
   *
   * Kalau alert "telat" menyala tepat di detik tenggat, setiap invoice akan
   * memicu alert pada waktu yang paling tidak berguna - dan merchant yang
   * paysen beberapa detik sebelum tenggat tidak akan pernah diberi tahu.
   */
  const result = classifyReceivables(
    [{ final_price: 10_000, receivable_due_at: new Date(NOW).toISOString() }],
    NOW,
  );

  assert.equal(result.overdue, 0);
  // Masih masuk "segera" karena masih dalam jendela 3 hari.
  assert.equal(result.dueSoon, 10_000);
});

test("invoice tanpa tenggat tetap outstanding tapi tidak terklasifikasi", () => {
  const result = classifyReceivables(
    [{ final_price: 30_000, receivable_due_at: null }],
    NOW,
  );

  // Uangnya tetap milik Lacte dan tidak boleh hilang dari total.
  assert.equal(result.outstanding, 30_000);
  // Tapi tidak bisa ditegur lewat alert tanpa tenggat yang jelas.
  assert.equal(result.overdue, 0);
  assert.equal(result.dueSoon, 0);
});

test("tenggat yang tidak bisa diparse diabaikan tanpa melempar", () => {
  const result = classifyReceivables(
    [
      { final_price: 10_000, receivable_due_at: "bukan tanggal" },
      { final_price: 20_000, receivable_due_at: inDays(7) },
    ],
    NOW,
  );

  assert.equal(result.outstanding, 30_000);
  assert.equal(result.overdueCount, 0);
  assert.equal(result.dueSoonCount, 0);
});

test("campuran: total outstanding adalah jumlah semua invoice", () => {
  const result = classifyReceivables(
    [
      { final_price: 100_000, receivable_due_at: inDays(-5) }, // overdue
      { final_price: 200_000, receivable_due_at: inDays(1) }, // due soon
      { final_price: 300_000, receivable_due_at: inDays(30) }, // normal
    ],
    NOW,
  );

  assert.equal(result.outstanding, 600_000);
  assert.equal(result.overdue, 100_000);
  assert.equal(result.overdueCount, 1);
  assert.equal(result.dueSoon, 200_000);
  assert.equal(result.dueSoonCount, 1);
});

test("daftar kosong memberi nol, bukan NaN", () => {
  const result = classifyReceivables([], NOW);
  assert.equal(result.outstanding, 0);
  assert.equal(result.overdue, 0);
  assert.equal(result.dueSoon, 0);
});