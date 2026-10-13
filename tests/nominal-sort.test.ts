import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNominalAmount,
  isPassLikeItem,
  sortCatalogItems,
  sortNominalItems,
} from "../src/lib/nominal-sort.ts";

test("extractNominalAmount: A + B = jumlah, max bila tanpa plus, titik = ribuan", () => {
  assert.equal(extractNominalAmount("86 Diamonds"), 86);
  assert.equal(extractNominalAmount("5 Diamond"), 5);
  assert.equal(extractNominalAmount("60 UC"), 60);
  // "A + B" dijumlahkan: 300+30 = 330, bukan 300.
  assert.equal(extractNominalAmount("300 + 30 Crystals"), 330);
  assert.equal(extractNominalAmount("40 + 4 Diamonds"), 44);
  assert.equal(extractNominalAmount("78+8 Diamond"), 86);
  assert.equal(extractNominalAmount("3099 + 589 Diamonds"), 3688);
  assert.equal(extractNominalAmount("1.980 Monochrome"), 1980);
  assert.equal(extractNominalAmount("2.180 Lattices"), 2180);
  assert.equal(extractNominalAmount("Steam Wallet Code Rp 100.000"), 100000);
  assert.equal(extractNominalAmount("Weekly Diamond Pass"), null);
  assert.equal(extractNominalAmount("Blessing of the Welkin Moon"), null);
});

test("extractNominalAmount: max semua angka, bukan yang pertama", () => {
  /*
   * Nama game dengan angka (AU2) adalah kebisingan, bukan nominal.
   * "AU2 60 Diamonds": "2" dari AU2 < "60" yang sebenarnya.
   * Tanpa max, semua produk AU2 menggerombol di posisi 2.
   */
  assert.equal(extractNominalAmount("AU2 60 Diamonds"), 60);
  assert.equal(extractNominalAmount("AU2 120 Diamonds"), 120);
  assert.equal(extractNominalAmount("AU2 1.300 Diamonds"), 1300);
  // Pengali "2x" bukan nominal - 50 adalah.
  assert.equal(extractNominalAmount("2x 50 Diamonds"), 50);
  assert.equal(extractNominalAmount("3x 100 Lattices"), 100);
});

test("sortNominalItems: jumlah kecil di atas, tanpa jumlah di belakang by harga", () => {
  const items = [
    { label: "172 Diamonds", sellingPrice: 42000 },
    { label: "Weekly Diamond Pass", sellingPrice: 27000 },
    { label: "5 Diamonds", sellingPrice: 2000 },
    { label: "86 Diamonds", sellingPrice: 21500 },
    { label: "Twilight Pass", sellingPrice: 150000 },
  ];

  const sorted = sortNominalItems(items);
  assert.deepEqual(
    sorted.map((item) => item.label),
    ["5 Diamonds", "86 Diamonds", "172 Diamonds", "Weekly Diamond Pass", "Twilight Pass"],
  );
});

test("sortNominalItems: jumlah sama jatuh ke harga, tidak mengubah input asli", () => {
  const items = [
    { label: "60 UC", sellingPrice: 16000 },
    { label: "60 UC Hemat", sellingPrice: 15000 },
  ];
  const sorted = sortNominalItems(items);
  assert.deepEqual(sorted.map((item) => item.label), ["60 UC Hemat", "60 UC"]);
  assert.equal(items[0]!.label, "60 UC", "array input tidak boleh termutasi");
});

test("sortNominalItems: format ribuan Indonesia terbaca benar", () => {
  const items = [
    { label: "2.180 Lattices", sellingPrice: 400000 },
    { label: "100 Lattices", sellingPrice: 20000 },
    { label: "1.000 Lattices", sellingPrice: 200000 },
  ];
  const sorted = sortNominalItems(items);
  assert.deepEqual(
    sorted.map((item) => item.label),
    ["100 Lattices", "1.000 Lattices", "2.180 Lattices"],
  );
});

test("isPassLikeItem: pass/membership/card terdeteksi dari label dan note", () => {
  assert.equal(isPassLikeItem("Weekly Diamond Pass"), true);
  assert.equal(isPassLikeItem("Weekly Membership"), true);
  assert.equal(isPassLikeItem("Blessing of the Welkin Moon"), true);
  assert.equal(isPassLikeItem("Twilight Pass"), true);
  assert.equal(isPassLikeItem("86 Diamonds", "Hemat"), false);
  assert.equal(isPassLikeItem("60 UC"), false);
});

test("sortCatalogItems: pass di atas, lalu jumlah kecil ke besar", () => {
  const items = [
    { label: "172 Diamonds", note: null, sellingPrice: 42000 },
    { label: "5 Diamonds", note: null, sellingPrice: 2000 },
    { label: "Weekly Diamond Pass", note: null, sellingPrice: 27000 },
    { label: "86 Diamonds", note: "Populer", sellingPrice: 21500 },
    { label: "Weekly Membership", note: null, sellingPrice: 29000 },
  ];

  const sorted = sortCatalogItems(items);
  assert.deepEqual(
    sorted.map((item) => item.label),
    [
      "Weekly Diamond Pass",
      "Weekly Membership",
      "5 Diamonds",
      "86 Diamonds",
      "172 Diamonds",
    ],
  );
});
