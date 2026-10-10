import assert from "node:assert/strict";
import test from "node:test";

import { calculatePricing } from "../src/lib/pricing.ts";
import {
  MERCHANT_RETAIL_PAYMENT_METHOD_ID,
  type PaymentMethod,
} from "../src/lib/catalog.ts";
import type { SupplierPricedPackage } from "../src/lib/supplier-pricing.ts";

/**
 * Jalur merchant ritel — perilaku pricing yang tidak boleh bocor ke jalur lain.
 *
 * Test ini mengunci DUA hal yang kalau bocor, kerugiannya nyata:
 *
 * 1. Guard `minimumNambahProfit` HARUS dilewati untuk `merchant_retail`.
 *    Biaya layanan 100% milik merchant, jadi `nambahProfit` selalu 0. Tanpa
 *    pengecualian ini, SETIAP order merchant ditolak di checkout dan
 *    fiturnya tidak pernah bisa dipakai sama sekali.
 *
 * 2. Guard itu HARUS tetap jalan untuk payment method lain. Kalau
 *    pengecualiannya ditulis terlalu luas (mis. membandingkan nilai
 *    profit, bukan method id), order QRIS yang marginny tipis ikut lolos —
 *    dan itu kehilangan uang sungguhan.
 */

const qris: PaymentMethod = {
  id: "qris",
  name: "QRIS",
  detail: "Semua aplikasi pembayaran",
  customerFeeFlat: 0,
  customerFeePercent: 0,
  merchantFeeFlat: 0,
  merchantFeePercent: 0,
};

const merchantRetail: PaymentMethod = {
  id: MERCHANT_RETAIL_PAYMENT_METHOD_ID,
  name: "Beli di Toko Ritel",
  detail: "Bayar langsung ke merchant",
  customerFeeFlat: 0,
  customerFeePercent: 0,
  merchantFeeFlat: 0,
  merchantFeePercent: 0,
};

/**
 * Margin 200 — di BAWAH `MINIMUM_NAMBAH_PROFIT` (500).
 *
 * Angka 500 sendiri TIDAK ditolak: guard pakai `<` bukan `<=`, jadi margin
 * tepat di ambang masih lolos. Test memakai 200 supaya margin benar-benar
 * tipis dan perbedaan kedua jalur terlihat jelas.
 */
const thinMargin: SupplierPricedPackage = {
  id: "p1",
  label: "60 Diamonds",
  sellingPrice: 20_000,
  referencePrice: 25_000,
  supplierCost: 19_800,
};

test("merchant_retail: fee menambah harga user tanpa menambah profit Lacte", () => {
  const plain = calculatePricing({
    item: healthyMargin,
    paymentMethod: merchantRetail,
    promotion: null,
    referral: null,
    merchantServiceFeePercent: 0,
  });
  const withFee = calculatePricing({
    item: healthyMargin,
    paymentMethod: merchantRetail,
    promotion: null,
    referral: null,
    merchantServiceFeePercent: 5,
  });

  // Harga katalog 30.000, fee 5% → user bayar 1.500 lebih.
  assert.equal(withFee.merchantServiceFee, 1_500);
  assert.equal(withFee.finalPrice, plain.finalPrice + 1_500);

  // INI inti dari model bisnisnya: Lacte tidak menerima satu rupiah pun dari
  // fee merchant. Kalau profit ikut naik, dashboard akan berbohong dan
  // keputusan "apakah jalur ini untung" tidak bisa diambil dari data.
  assert.equal(
    withFee.nambahProfit,
    plain.nambahProfit,
    "fee merchant tidak boleh masuk ke profit Lacte",
  );
});

test("fee merchant TIDAK berlaku untuk payment method lain", () => {
  // Nilai fee sengaja diteruskan untuk payment method QRIS. Kalau
  // implementasinya lupa mengecek id, QRIS ikut naik dan user diberi
  // biaya yang tidak pernah dia pilih.
  const result = calculatePricing({
    item: healthyMargin,
    paymentMethod: qris,
    promotion: null,
    referral: null,
    merchantServiceFeePercent: 5,
  });

  assert.equal(result.merchantServiceFee, 0);
  assert.equal(result.finalPrice, 30_000);
});

test("merchant_retail: guard minimumNambahProfit dilewati", () => {
  const result = calculatePricing({
    item: thinMargin,
    paymentMethod: merchantRetail,
    promotion: null,
    referral: null,
  });

  assert.equal(
    result.rejectionCode,
    null,
    "order merchant harus lolos walau margin di bawah minimum",
  );
  assert.equal(result.rejectionReason, null);
});

test("merchant_retail: nambahProfit tetap dihitung dari margin, bukan di-nol-kan", () => {
  const result = calculatePricing({
    item: thinMargin,
    paymentMethod: merchantRetail,
    promotion: null,
    referral: null,
  });

  /*
   * CATATAN KOREKSI: merchant SELALU dapat 0 (fee 100% miliknya), TAPI
   * `nambahProfit` di kalkulasi TIDAK di-nol-kan — nilainya tetap margin
   * harga jual dikurangi modal supplier.
   *
   * Margin itu akan kembali ke Lacte sebagai pelunasan piutang setelah
   * merchant pays. Jadi angkanya bukan "profit", tapi "nilai yang akan
   * ditagih", dan sengaja dibiarkan tampil di sini supaya tidak sekadar
   * di-hardcode 0 yang membuat dashboard sulit diaudit.
   */
  assert.equal(result.nambahProfit, 200);
  assert.ok(
    result.nambahProfit > 0,
    "margin harus tetap dihitung supaya bisa jadi acuan tagihan piutang",
  );
});

test("QRIS dengan margin sama tetap DITOLAK", () => {
  const result = calculatePricing({
    item: thinMargin,
    paymentMethod: qris,
    promotion: null,
    referral: null,
  });

  assert.equal(
    result.rejectionCode,
    "profit_below_minimum",
    "guard harus tetap berlaku untuk jalur selain merchant_retail",
  );
});

const healthyMargin: SupplierPricedPackage = {
  id: "p2",
  label: "100 Diamonds",
  sellingPrice: 30_000,
  referencePrice: 35_000,
  supplierCost: 20_000,
};

test("QRIS dengan margin sehat tetap diterima", () => {
  const result = calculatePricing({
    item: healthyMargin,
    paymentMethod: qris,
    promotion: null,
    referral: null,
  });

  assert.equal(result.rejectionCode, null);
});

test("merchant_retail: guard points tetap berlaku", () => {
  // Yang dilewati HANYA `minimumNambahProfit`. Guard lain — terutama
  // pengaman points yang melebihi subtotal — harus tetap menahan.
  //
  // Ini lapisan pengaman yang berbeda dari guard profit: kalau ikut
  // dilewati, user bisa memakai points melebihi nilai order dan saldo
  // points-nya tidak akan kembali.
  const result = calculatePricing({
    item: healthyMargin,
    paymentMethod: merchantRetail,
    promotion: null,
    referral: null,
    pointsDiscount: 999_999,
    loyaltyEligible: true,
  });

  assert.equal(
    result.rejectionCode,
    "points_exceed_subtotal",
    "guard points tidak boleh dilewati oleh jalur merchant",
  );
});