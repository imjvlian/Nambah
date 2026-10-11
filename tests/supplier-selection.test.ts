import test from "node:test";
import assert from "node:assert/strict";

import {
  availableBalance,
  pilihSupplier,
  supplierForSku,
} from "../src/lib/suppliers/select.ts";
import {
  normalizeSupplierStatus,
  toSupplierAmount,
  toSupplierStock,
  isSupplierId,
  knownSupplierIds,
} from "../src/lib/suppliers/types.ts";
import type {
  SupplierBalance,
  SupplierQuote,
} from "../src/lib/suppliers/types.ts";

/**
 * Pemilihan supplier menentukan uang mana yang dipakai membayar top up.
 * Salah pilih berarti order gagal SETELAH pembeli membayar - jadi test
 * di sini tidak hanya soal kebenaran aritmetika, tapi soal tidak
 * Mwcategorikan keadaan yang tidak_wrapper disadari.
 */

const saldo = (
  supplierId: string,
  balance: number,
  reserved = 0,
): SupplierBalance => ({ supplierId, balance, reserved });

const quote = (
  supplierId: string,
  sku: string,
  cost: number,
  stock: number | null = null,
): SupplierQuote => ({ supplierId, sku, cost, stock });

/* ==========================================================================
   availableBalance - berapa yang benar-benar bisa dibelanjakan.
   ========================================================================== */

test("saldo bebas dikurangi yang sudah dipesan", () => {
  assert.equal(availableBalance(saldo("digiflazz", 100_000, 40_000)), 60_000);
});

test("saldo negatif dijepit ke nol, bukan diteruskan", () => {
  // Saldo negatif berarti tidak ada yang bisa dibelanjakan. Kalau
  // diteruskan apa adanya, perbandingan `saldo >= cost` untuk cost kecil
  // bisa lolos dan order dikirim ke supplier yang sudah tidak punya uang.
  assert.equal(availableBalance(saldo("digiflazz", 10_000, 15_000)), 0);
});

test("supplier tanpa entri saldo dianggap nol", () => {
  assert.equal(availableBalance(undefined), 0);
});

/* ==========================================================================
   Aturan dasar: harga termurah.
   ========================================================================== */

test("memilih harga termurah saat keduanya mampu bayar", () => {
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 12_000), quote("melostore", "M-1", 11_500)],
    [saldo("digiflazz", 100_000), saldo("melostore", 100_000)],
  );

  assert.equal(hasil.ok, true);
  if (!hasil.ok) return;
  assert.equal(hasil.choice.supplierId, "melostore");
  assert.equal(hasil.choice.sku, "M-1");
  assert.equal(hasil.choice.cost, 11_500);
});

test("harga mahal tetap dipilih kalau yang murah tidak mampu bayar", () => {
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 12_000), quote("melostore", "M-1", 11_500)],
    [saldo("digiflazz", 100_000), saldo("melostore", 5_000)],
  );

  assert.equal(hasil.ok, true);
  if (!hasil.ok) return;
  assert.equal(hasil.choice.supplierId, "digiflazz");
});

/* ==========================================================================
   Saldo harus cukup - termasuk yang sudah dipesan order lain.
   ========================================================================== */

test("saldo yang seluruhnya sudah dipesan tidak bisa dipakai", () => {
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 12_000)],
    [saldo("digiflazz", 50_000, 50_000)],
  );

  assert.equal(hasil.ok, false);
  if (hasil.ok) return;
  assert.equal(hasil.reason, "insufficient-balance");
});

test("saldo pas sama dengan harga dianggap cukup", () => {
  // `>=`, bukan `>`. Menolak saldo yang pas sama akan menolak order
  // terakhir yang sebenarnya masih bisa dibayar.
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 12_000)],
    [saldo("digiflazz", 12_000)],
  );

  assert.equal(hasil.ok, true);
});

test("satu rupiah kurang dianggap tidak cukup", () => {
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 12_000)],
    [saldo("digiflazz", 11_999)],
  );

  assert.equal(hasil.ok, false);
});

test("supplier tanpa baris saldo tidak pernah dipilih", () => {
  // Tanpa entri saldo berarti tidak diketahui. Menganggapnya "saldo
  // tidak terbatas" akan mengirim order ke supplier yang belum pernah
  // dicek - masalahnya baru ketahuan setelah uang diterima.
  const hasil = pilihSupplier(
    [quote("melostore", "M-1", 5_000)],
    [saldo("digiflazz", 999_999)],
  );

  assert.equal(hasil.ok, false);
  if (hasil.ok) return;
  assert.equal(hasil.reason, "insufficient-balance");
});

/* ==========================================================================
   Stok: nol berarti habis, null berarti tidak diketahui.
   ========================================================================== */

test("stok nol dibuang,,null tidak", () => {
  // Melostore tidak mengirim stok di price-list-nya. Kalau `null` ikut
  // dibuang, supplier itu tidak akan pernah dipilih - dan tidak ada
  // error yang bisa blamed karena itu kelihatannya "stok habis".
  const hasil = pilihSupplier(
    [
      quote("digiflazz", "D-1", 9_000, 0),
      quote("melostore", "M-1", 12_000, null),
    ],
    [saldo("digiflazz", 999_999), saldo("melostore", 999_999)],
  );

  assert.equal(hasil.ok, true);
  if (!hasil.ok) return;
  assert.equal(hasil.choice.supplierId, "melostore");
});

test("semua stok habis ditolak dengan alasan yang tepat", () => {
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 9_000, 0), quote("melostore", "M-1", 12_000, 0)],
    [saldo("digiflazz", 999_999), saldo("melostore", 999_999)],
  );

  assert.equal(hasil.ok, false);
  if (hasil.ok) return;
  assert.equal(hasil.reason, "out-of-stock");
});

test("stok negatif dianggap tidak diketahui, bukan habis", () => {
  // Stok negatif tidak mungkin terjadi, tapi kalau muncul berarti
  // responsnya rusak - bukan berarti produk habis. Menolaknya akan
  // mematikan produk yang sebenarnya bisa dibeli.
  const hasil = pilihSupplier(
    [quote("melostore", "M-1", 5_000, -1)],
    [saldo("melostore", 999_999)],
  );

  assert.equal(hasil.ok, true);
});

/* ==========================================================================
   Harga tidak valid.
   ========================================================================== */

test("harga nol dan negatif dibuang", () => {
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 0), quote("digiflazz", "D-2", -5)],
    [saldo("digiflazz", 999_999)],
  );

  assert.equal(hasil.ok, false);
  if (hasil.ok) return;
  assert.equal(hasil.reason, "invalid-cost");
});

test("harga pecahan dibuang, bukan dibulatkan diam-diam", () => {
  // Pembulatan diam-diam membuat margin melenceng tanpa ada yang
  // bisa menjelaskan kenapa marginnya tidak sesuai.
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", 1500.4)],
    [saldo("digiflazz", 999_999)],
  );

  assert.equal(hasil.ok, false);
  if (hasil.ok) return;
  assert.equal(hasil.reason, "invalid-cost");
});

test("NaN dianggap harga tidak valid", () => {
  const hasil = pilihSupplier(
    [quote("digiflazz", "D-1", Number.NaN)],
    [saldo("digiflazz", 999_999)],
  );

  assert.equal(hasil.ok, false);
});

/* ==========================================================================
   Kasus kosong.
   ========================================================================== */

test("tidak ada supplier sama sekali", () => {
  const hasil = pilihSupplier([], [saldo("digiflazz", 999_999)]);

  assert.equal(hasil.ok, false);
  if (hasil.ok) return;
  assert.equal(hasil.reason, "no-quotes");
});

test("pesan penolakan selalu terisi", () => {
  // Pesan kosong akan tampil sebagai `null` di halaman checkout karena
  // cara render-nya tidak mengecek string kosong.
  const hasil = pilihSupplier([], []);
  assert.equal(hasil.ok, false);
  if (hasil.ok) return;
  assert.ok(hasil.detail.length > 0);
});

/* ==========================================================================
   Determinisme - laporan harus bisa direproduksi.
   ========================================================================== */

test("harga sama memilih id yang sama apa pun urutan inputnya", () => {
  const a = pilihSupplier(
    [quote("digiflazz", "D-1", 10_000), quote("melostore", "M-1", 10_000)],
    [saldo("digiflazz", 999_999), saldo("melostore", 999_999)],
  );
  const b = pilihSupplier(
    [quote("melostore", "M-1", 10_000), quote("digiflazz", "D-1", 10_000)],
    [saldo("digiflazz", 999_999), saldo("melostore", 999_999)],
  );

  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  // Tanpa aturan ini, dua request dengan data identik bisa memilih
  // supplier berbeda hanya karena urutan array berbeda - dan laporan
  // jadi tidak bisa direproduksi.
  assert.equal(a.choice.supplierId, b.choice.supplierId);
});

test("pilihan tidak berubah saat ada supplier lebih mahal tambahan", () => {
  const sebelum = pilihSupplier(
    [quote("digiflazz", "D-1", 10_000), quote("melostore", "M-1", 11_000)],
    [saldo("digiflazz", 999_999), saldo("melostore", 999_999)],
  );
  const sesudah = pilihSupplier(
    [
      quote("digiflazz", "D-1", 10_000),
      quote("melostore", "M-1", 11_000),
      quote("suplier-lain", "X-1", 99_000),
    ],
    [
      saldo("digiflazz", 999_999),
      saldo("melostore", 999_999),
      saldo("suplier-lain", 999_999),
    ],
  );

  assert.equal(sebelum.ok && sesudah.ok, true);
  if (!sebelum.ok || !sesudah.ok) return;
  assert.equal(sesudah.choice.supplierId, sebelum.choice.supplierId);
});

/* ==========================================================================
   supplierForSku - yang dipakai admin saat pemetaan.
   ========================================================================== */

test("supplierForSku mengembalikan pemilik SKU", () => {
  const quotes = [quote("digiflazz", "D-1", 10_000), quote("melostore", "M-1", 9_000)];
  assert.equal(supplierForSku(quotes, "M-1"), "melostore");
});

test("supplierForSku null kalau SKU tidak ada di katalog", () => {
  assert.equal(supplierForSku([quote("digiflazz", "D-1", 10_000)], "HILANG"), null);
});

/* ==========================================================================
   normalizeSupplierStatus.
   ========================================================================== */

test("status Digiflazz dalam huruf kapital dinormalisasi", () => {
  assert.equal(normalizeSupplierStatus("Sukses"), "success");
  assert.equal(normalizeSupplierStatus("Pending"), "pending");
  assert.equal(normalizeSupplierStatus("Gagal"), "failed");
});

test("status Melostore huruf kecil dinormalisasi", () => {
  assert.equal(normalizeSupplierStatus("success"), "success");
  assert.equal(normalizeSupplierStatus("processing"), "pending");
  assert.equal(normalizeSupplierStatus("failed"), "failed");
});

test("spasi dan huruf besar-kecil tidak berpengaruh", () => {
  assert.equal(normalizeSupplierStatus("  SUKSES  "), "success");
});

test("status tak dikenal mengembalikan null, bukan failed", () => {
  // null berarti pemanggil yang memutuskan. Mengembalikan "failed"
  // otomatis akan membakar reputasi supplier untuk order yang
  // sebenarnya masih diproses.
  assert.equal(normalizeSupplierStatus("entah"), null);
  assert.equal(normalizeSupplierStatus(""), null);
  assert.equal(normalizeSupplierStatus(null), null);
  assert.equal(normalizeSupplierStatus(undefined), null);
  assert.equal(normalizeSupplierStatus(42), null);
});

/* ==========================================================================
   toSupplierAmount / toSupplierStock.
   ========================================================================== */

test("nominal diterima sebagai angka maupun string", () => {
  assert.equal(toSupplierAmount(1000), 1000);
  assert.equal(toSupplierAmount("1000"), 1000);
  assert.equal(toSupplierAmount(" 2500 "), 2500);
  assert.equal(toSupplierAmount(1500.6), 1501);
});

test("string kosong bukan nol", () => {
  // `Number("")` adalah 0. Kalau jadi 0, saldo supplier yang gagal
  // terbaca akan terlihat sebagai saldo nol yang sah - dan order akan
  // ditolak dengan alasan yang salah.
  assert.equal(toSupplierAmount(""), null);
  assert.equal(toSupplierAmount("   "), null);
  assert.equal(toSupplierAmount(null), null);
  assert.equal(toSupplierAmount(undefined), null);
  assert.equal(toSupplierAmount("bukan angka"), null);
});

test("nilai tidak hingga ditolak", () => {
  assert.equal(toSupplierAmount(Number.POSITIVE_INFINITY), null);
  assert.equal(toSupplierAmount(Number.NaN), null);
});

test("stok boolean bukan angka", () => {
  assert.equal(toSupplierStock(true), null);
  assert.equal(toSupplierStock("5"), 5);
  assert.equal(toSupplierStock(-1), null);
});

/* ==========================================================================
   isSupplierId - gerbang sebelum supplier dipakai.
   ========================================================================== */

test("id supplier yang dikenal diterima", () => {
  assert.equal(isSupplierId("digiflazz"), true);
  assert.equal(isSupplierId("melostore"), true);
});

test("id sembarang ditolak", () => {
  // `orders.supplier_id` adalah kolom TEXT. Nilai bisa saja tidak
  // dikenal karena typo di admin atau baris lama - dan keduanya harus
  // ditolak sebelum sempat dipakai, bukan diteruskan jadi undefined.
  assert.equal(isSupplierId("meltostore"), false);
  assert.equal(isSupplierId("DIGIFLAZZ"), false);
  assert.equal(isSupplierId(""), false);
  assert.equal(isSupplierId(null), false);
  assert.equal(isSupplierId(42), false);
});

test("daftar supplier yang dikenal stabil", () => {
  assert.deepEqual(knownSupplierIds(), ["digiflazz", "melostore"]);
});