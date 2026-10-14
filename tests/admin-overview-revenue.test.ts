import assert from "node:assert/strict";
import { test } from "node:test";

import { overviewRevenue } from "../src/lib/admin-overview-revenue.ts";

const ritel = (finalPrice: number, paid = false) => ({
  final_price: finalPrice,
  service_fee_amount: 0,
  merchant_id: "merchant-1",
  receivable_paid_at: paid ? "2026-01-01T00:00:00Z" : null,
});

test("order biasa: omzet sama dengan final price", () => {
  const result = overviewRevenue([
    {
      final_price: 50_000,
      service_fee_amount: null,
      merchant_id: null,
      receivable_paid_at: null,
    },
  ]);

  assert.equal(result.revenueToday, 50_000);
  assert.equal(result.retailReceivableToday, 0);
});

test("fee toko tidak ikut dihitung sebagai omzet Lacte", () => {
  /*
   * `final_price` sudah memuat `merchantServiceFee`. Biaya layanan itu
   * dibayar pengguna langsung ke merchant di tokonya, jadi menjumlahkan
   * `final_price` mentah membuat kartu omzet lebih besar dari uang yang
   * benar-benar masuk Lacte - dan lebih besar dari angka Arus Kas.
   */
  const result = overviewRevenue([
    {
      final_price: 43_100,
      service_fee_amount: 3_000,
      merchant_id: null,
      receivable_paid_at: null,
    },
  ]);

  assert.equal(result.revenueToday, 40_100);
});

test("ritel yang piutangnya sudah dibayar masuk penuh ke omzet", () => {
  const result = overviewRevenue([ritel(120_000, true)]);

  assert.equal(result.revenueToday, 120_000);
  assert.equal(result.retailReceivableToday, 0);
});

test("ritel yang belum dibayar tidak masuk omzet, tapi dilaporkan terpisah", () => {
  /*
   * Top up-nya sudah terkirim ke pembeli, tapi uangnya masih di tangan toko.
   * Menghitungnya sebagai omzet membuat hari ini terlihat sehat padahal uangnya
   * belum tertagih - jadi dipisahkan, bukan dihitung, dan bukan disembunyikan.
   */
  const result = overviewRevenue([ritel(120_000, false)]);

  assert.equal(result.revenueToday, 0);
  assert.equal(result.retailReceivableToday, 120_000);
});

test("fee toko juga dipotong dari nominal ritel yang tertahan", () => {
  const result = overviewRevenue([
    {
      final_price: 100_000,
      service_fee_amount: 5_000,
      merchant_id: "merchant-1",
      receivable_paid_at: null,
    },
  ]);

  assert.equal(result.revenueToday, 0);
  assert.equal(result.retailReceivableToday, 95_000);
});

test("kcampuran ritel dan non ritel: hanya ritel yang tertahan", () => {
  const result = overviewRevenue([
    {
      final_price: 100_000,
      service_fee_amount: null,
      merchant_id: null,
      receivable_paid_at: null,
    },
    ritel(60_000, true),
    ritel(40_000, false),
  ]);

  assert.equal(result.revenueToday, 160_000);
  assert.equal(result.retailReceivableToday, 40_000);
});

test("tanpa order: nol, bukan NaN", () => {
  const result = overviewRevenue([]);

  assert.equal(result.revenueToday, 0);
  assert.equal(result.retailReceivableToday, 0);
});

test("kolom null tidak menggeser total", () => {
  const result = overviewRevenue([
    {
      final_price: null,
      service_fee_amount: null,
      merchant_id: null,
      receivable_paid_at: null,
    },
    {
      final_price: "75000",
      service_fee_amount: null,
      merchant_id: null,
      receivable_paid_at: null,
    },
  ]);

  assert.equal(result.revenueToday, 75_000);
});