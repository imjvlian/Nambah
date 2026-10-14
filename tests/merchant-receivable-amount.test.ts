import assert from "node:assert/strict";
import test from "node:test";

import { merchantReceivableAmount } from "../src/lib/merchant-retail-rules.ts";

/**
 * Piutang Lacte atas satu order ritel.
 *
 * Yang diuji di sini adalah satu-satunya definisi "berapa yang Lacte
 * rightfully menagih ke toko". Kalau fungsi ini salah, tiga laporan
 * sekaligus ikut salah - kartu Toko ritel, alokasi FIFO pelunasan, dan
 * posisi piutang di Arus Kas.
 *
 * Fungsi ini pernah salah di empat tempat sekaligus, dan seluruh tabel
 * "Catatan kas harian" beserta kartu Toko ritel ikut mewarisi angkanya.
 */

test("fee toko dikurangi dari piutang", () => {
  assert.equal(
    merchantReceivableAmount({ finalPrice: 7_100, serviceFee: 2_000 }),
    5_100,
  );
  // Kasus nyata di produksi: order Weekly Diamond Pass dari toko JVLIAN.
  assert.equal(
    merchantReceivableAmount({ finalPrice: 43_100, serviceFee: 3_000 }),
    40_100,
  );
});

test("order tanpa fee tidak berubah", () => {
  assert.equal(merchantReceivableAmount({ finalPrice: 5_100, serviceFee: 0 }), 5_100);
  assert.equal(merchantReceivableAmount({ finalPrice: 5_100, serviceFee: null }), 5_100);
});

test("angka dari database dibaca sebagai string", () => {
  // PostgREST mengembalikan numeric sebagai string.
  assert.equal(
    merchantReceivableAmount({ finalPrice: "43100", serviceFee: "3000" }),
    40_100,
  );
});

test("nilai rusak jadi nol, bukan NaN", () => {
  assert.equal(merchantReceivableAmount({ finalPrice: null, serviceFee: null }), 0);
  assert.equal(merchantReceivableAmount({ finalPrice: undefined, serviceFee: undefined }), 0);
  assert.equal(merchantReceivableAmount({ finalPrice: "bukan angka", serviceFee: 0 }), 0);
});

test("piutang tidak pernah negatif", () => {
  // Fee lebih besar dari final_price berarti data rusak. Menghasilkan
  // piutang negatif akan membuat Lacte terlihat berutang ke merchant -
  // dan `syncMerchantBalance` akan memutarnya jadi kredit palsu.
  assert.equal(merchantReceivableAmount({ finalPrice: 1_000, serviceFee: 5_000 }), 0);
  assert.equal(merchantReceivableAmount({ finalPrice: 0, serviceFee: 3_000 }), 0);
});