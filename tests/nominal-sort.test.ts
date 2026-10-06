import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNominalAmount,
  sortNominalItems,
} from "../src/lib/nominal-sort.ts";

test("extractNominalAmount: angka pertama, titik = ribuan", () => {
  assert.equal(extractNominalAmount("86 Diamonds"), 86);
  assert.equal(extractNominalAmount("5 Diamond"), 5);
  assert.equal(extractNominalAmount("60 UC"), 60);
  assert.equal(extractNominalAmount("300 + 30 Crystals"), 300);
  assert.equal(extractNominalAmount("1.980 Monochrome"), 1980);
  assert.equal(extractNominalAmount("2.180 Lattices"), 2180);
  assert.equal(extractNominalAmount("Steam Wallet Code Rp 100.000"), 100000);
  assert.equal(extractNominalAmount("Weekly Diamond Pass"), null);
  assert.equal(extractNominalAmount("Blessing of the Welkin Moon"), null);
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
