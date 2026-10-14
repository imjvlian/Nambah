import assert from "node:assert/strict";
import test from "node:test";

import {
  brandLabel,
  fulfillmentFailedText,
  fulfillmentSuccessText,
  supplierLabel,
} from "../src/lib/fulfillment-alert-text.ts";

/**
 * Isi pesan alert fulfilment.
 *
 * Yang diuji di sini persis masalah yang dilaporkan: pesan sukses harus
 * menyebut brand game (bukan hanya nama paket) dan harus menyebut Melostore
 * sebagai supplier, sehingga order Melostore bisa dibedakan dari order
 * Digiflazz yang nama paketnya sama.
 */

const melostoreTransaction = {
  supplier_id: "melostore",
  supplier_sku: "mlidwdp3d-s5",
  serial_number: "MLO20261013YBQR5P27",
  message: "Melostore success",
};

test("supplierLabel: melostore dan digiflazz punya nama yang enak dibaca", () => {
  assert.equal(supplierLabel("melostore"), "Melostore");
  assert.equal(supplierLabel("digiflazz"), "Digiflazz");
  // Supplier baru tidak boleh hilang - disembunyikan jadi "-", ordernya
  // terlihat sama dengan order tanpa supplier.
  assert.equal(supplierLabel("tokopedia"), "Tokopedia");
  assert.equal(supplierLabel(null), "-");
  assert.equal(supplierLabel(""), "-");
});

test("brandLabel: memakai nama game, bukan id", () => {
  assert.equal(
    brandLabel({ id: "mobile-legends", name: "Mobile Legends", short_name: "ML" }, "fallback"),
    "Mobile Legends",
  );
});

test("brandLabel: override nama tampilan ikut dipakai", () => {
  assert.equal(
    brandLabel(
      { id: "lifeafter-credits", name: "Lifeafter Credits", short_name: "LAC" },
      "fallback",
    ),
    "LifeAfter",
  );
});

test("brandLabel: jatuh ke fallback saat game tidak ada atau namanya kosong", () => {
  assert.equal(brandLabel(null, "fallback"), "fallback");
  assert.equal(brandLabel({ id: "x", name: null, short_name: null }, "fallback"), "fallback");
  assert.equal(brandLabel({ id: "x", name: "   ", short_name: "S" }, "fallback"), "fallback");
});

test("pesan sukses menyebut brand game dan Melostore", () => {
  const text = fulfillmentSuccessText({
    orderId: "NBH-20261013-AF4D65668A",
    brand: "Mobile Legends",
    productLabel: "128 Diamond",
    serialNumber: "MLO20261013YBQR5P27",
    transaction: melostoreTransaction,
    sellingPrice: 40100,
  });

  assert.match(text, /Brand game: Mobile Legends/);
  assert.match(text, /Supplier: Melostore/);
  assert.match(text, /SKU supplier: mlidwdp3d-s5/);
  assert.match(text, /SN: <code>MLO20261013YBQR5P27<\/code>/);
  assert.match(text, /Dibayar: Rp\s?40\.100/);
});

test("pesan gagal menyebut brand, supplier, dan alasan dari supplier", () => {
  const text = fulfillmentFailedText({
    orderId: "NBH-20261013-AF4D65668A",
    brand: "Mobile Legends",
    productLabel: "128 Diamond",
    transaction: { ...melostoreTransaction, message: "Saldo Melostore tidak cukup" },
    sellingPrice: 40100,
    supplierCost: 39000,
  });

  assert.match(text, /Brand game: Mobile Legends/);
  assert.match(text, /Supplier: Melostore/);
  assert.match(text, /Alasan: Saldo Melostore tidak cukup/);
  assert.match(text, /Modal: Rp\s?39\.000/);
});

test("tanpa transaksi supplier, pesan tetap terbaca dan menyebut '-'", () => {
  const text = fulfillmentSuccessText({
    orderId: "NBH-1",
    brand: "Mobile Legends",
    productLabel: "128 Diamond",
    serialNumber: "SN-1",
    transaction: null,
    sellingPrice: 1000,
  });

  assert.match(text, /Supplier: -/);
  // SKU kosong tidak boleh menambah baris kosong berlabel.
  assert.doesNotMatch(text, /SKU supplier:/);
});

test("data supplier di-escape supaya tidak merusak parse_mode HTML", () => {
  const text = fulfillmentFailedText({
    orderId: "NBH-1",
    brand: "Game <b>Bold</b>",
    productLabel: "Paket & lain",
    transaction: {
      supplier_id: "melostore",
      supplier_sku: "<script>x</script>",
      serial_number: null,
      message: "gagal & batal",
    },
    sellingPrice: 1000,
    supplierCost: 900,
  });

  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /Brand game: Game &lt;b&gt;Bold/);
  assert.match(text, /Paket &amp; lain/);
  assert.match(text, /Alasan: gagal &amp; batal/);
});