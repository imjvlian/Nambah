import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMerchantScanRow,
  relatedMerchantName,
  type MerchantScanRow,
} from "../src/lib/merchant-scan-row.ts";

/**
 * Normalisasi baris order untuk pemindaian kasir.
 *
 * Bug yang ditutup test ini: `getOrderForMerchantScan` pernah membaca
 * `row.orders`, yang tidak pernah ada di jawaban PostgREST untuk relasi
 * to-one. Hasil spread-nya hanya berisi `merchant_name`, sehingga
 * `merchant_id` jadi `undefined` dan `confirmMerchantScan` menolak
 * order milik toko sendiri dengan "Kode ini bukan untuk toko Anda."
 *
 * Gejalanya nasty: pratinjau (lookup) benar, hanya tombol
 * konfirmasi yang selalu ditolak.
 */

/** Bentuk nyata jawaban PostgREST: kolom datar + relasi objek. */
const flatRow: MerchantScanRow = {
  id: "NBH-20261014-02AD171CDB",
  merchant_id: "6afdf88f-73b0-46bb-8825-07a5886f79ed",
  status: "pending_merchant",
  final_price: 43100,
  expires_at: "2026-10-14T10:07:33.225+07:00",
  merchants: { name: "JVLIAN" },
};

test("merchant_id dari baris datar tetap terbaca", () => {
  const order = normalizeMerchantScanRow(flatRow);

  assert.ok(order);
  assert.equal(order.id, "NBH-20261014-02AD171CDB");
  /*
   * Inilah yang diuji. Kalau `merchant_id` hilang, cek kepemilikan
   * selalu gagal dan kasir tidak pernah bisa menerima pembayaran.
   */
  assert.equal(order.merchant_id, "6afdf88f-73b0-46bb-8825-07a5886f79ed");
  assert.equal(order.status, "pending_merchant");
  assert.equal(order.final_price, 43100);
});

test("nama toko diambil dari relasi merchants", () => {
  const order = normalizeMerchantScanRow(flatRow);
  assert.equal(order?.merchant_name, "JVLIAN");
});

test("relasi merchants boleh berupa array", () => {
  const order = normalizeMerchantScanRow({ ...flatRow, merchants: [{ name: "TOKO A" }] });
  assert.equal(order?.merchant_name, "TOKO A");
});

test("relasi merchants yang hilang tidak membuat baris hilang", () => {
  const order = normalizeMerchantScanRow({ ...flatRow, merchants: null });
  assert.ok(order);
  assert.equal(order.merchant_name, null);
  assert.equal(order.merchant_id, "6afdf88f-73b0-46bb-8825-07a5886f79ed");
});

test("order tanpa id ditolak, bukan diteruskan setengah jadi", () => {
  assert.equal(normalizeMerchantScanRow(null), null);
  assert.equal(normalizeMerchantScanRow(undefined), null);
  assert.equal(normalizeMerchantScanRow({ ...flatRow, id: "" }), null);
});

test("relatedMerchantName hanya menerima nama string", () => {
  assert.equal(relatedMerchantName({ name: "A" }), "A");
  assert.equal(relatedMerchantName({ name: 123 }), null);
  assert.equal(relatedMerchantName("bukan objek"), null);
  assert.equal(relatedMerchantName([]), null);
});