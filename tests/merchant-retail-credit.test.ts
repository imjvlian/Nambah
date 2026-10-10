import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECEIVABLE_IDR,
  evaluateMerchantCredit,
} from "../src/lib/merchant-retail-rules.ts";

/**
 * Aturan kredit merchant.
 *
 * Yang diuji di sini adalah FUNGSI MURNI (`evaluateMerchantCredit`), bukan
 * `checkMerchantCredit` yang(query database. Alasannya aturan ini adalah inti
 * bisnis dan paling rawan salah diam-diam: semua inputnya angka bulat biasa,
 * jadi kalau salah satu `+` hilang atau ada status yang terbalik, tidak ada
 * yang meledak — limitnya hanya jadi tidak dipatuhi.
 */

const credit = (outstanding: number, pending = 0) =>
  evaluateMerchantCredit({
    found: true,
    status: "active",
    outstanding,
    pending,
  });

test("merchant aktif dengan piutang kosong boleh terima order", () => {
  const result = credit(0);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, null);
});

test("merchant tidak ditemukan ditolak", () => {
  const result = evaluateMerchantCredit({
    found: false,
    status: null,
    outstanding: 0,
    pending: 0,
  });
  assert.equal(result.eligible, false);
});

test("merchant frozen dan inactive sama-sama ditolak", () => {
  for (const status of ["frozen", "inactive"] as const) {
    const result = evaluateMerchantCredit({
      found: true,
      status,
      outstanding: 0,
      pending: 0,
    });
    assert.equal(result.eligible, false, `status ${status} harus ditolak`);
  }
});

test("piutang yang sudah jadi saja sudah bisa menghabiskan limit", () => {
  assert.equal(credit(MAX_RECEIVABLE_IDR).eligible, false);
  assert.equal(credit(MAX_RECEIVABLE_IDR - 1).eligible, true);
});

test("order yang BELUM discan ikut menghabiskan limit", () => {
  /*
   * Ini test yang paling menentukan.
   *
   * Merchant boleh scan tanpa transfer lebih dulu, jadi begitu dia scan,
   * Lacte yang menanggung. Order `pending_merchant` karena itu bukan
   * sekadar "order yang belum dibayar user" - dia itu utang yang belum
   * tercatat.
   *
   * Kalau `pending` diabaikan di sini, semua order itu lolos pemeriksaan
   * kredit yang sama dalam hitungan detik, dan merchant bisa menembus
   * limit berkali-kali lipatan sebelum satu pun discan.
   */
  const result = credit(MAX_RECEIVABLE_IDR - 500_000, 500_000);
  assert.equal(result.committed, MAX_RECEIVABLE_IDR);
  assert.equal(result.eligible, false);
});

test("pending dihitung di committed tapi angka piutang tetap terpisah", () => {
  const result = credit(1_000_000, 2_000_000);

  // Keduanya dilaporkan terpisah supaya dashboard admin bisa menampilkan
  // "sudah jadi utang" dan "menunggu scan" sebagai dua angka berbeda.
  assert.equal(result.outstanding, 1_000_000);
  assert.equal(result.pending, 2_000_000);
  assert.equal(result.committed, 3_000_000);
  assert.equal(result.eligible, true);
});

test("limit tepat sama dengan batas penuh", () => {
  /*
   * Pakai `>=`, bukan `>`. Karena `MAX_RECEIVABLE_IDR` adalah BATAS yang
   * boleh terpakai penuh, order berikutnya harus ditolak tepat saat
   * committed menyentuh batas — bukan menunggu lewat satu rupiah.
   *
   * Dengan `>`, merchant bisa menambahkan order/gratis tanpa batas ketika
   * sudah persis penuh.
   */
  assert.equal(credit(MAX_RECEIVABLE_IDR - 1, 1).eligible, false);
});

test("limit khusus per merchant dihormati, bukan limit global", () => {
  const merchant = (outstanding: number) =>
    evaluateMerchantCredit({
      found: true,
      status: "active",
      outstanding,
      pending: 0,
      limit: 1_000_000,
    });

  // 800 ribu masih di bawah limit merchant ini meski jauh di bawah limit
  // global 5 juta - jadi dia harus tetap diterima.
  assert.equal(merchant(800_000).eligible, true);

  // Dan 1 juta TEPAT di limitnya harus ditolak, walaupun masih jauh di bawah
  // limit global. Ini yang membuktikan limit per merchant benar-benar dipakai.
  assert.equal(merchant(1_000_000).eligible, false);
  assert.equal(merchant(1_000_000).limit, 1_000_000);
});