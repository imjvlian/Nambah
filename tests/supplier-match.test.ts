import test from "node:test";
import assert from "node:assert/strict";

import {
  expectedPrefixes,
  isGameEligible,
  matchProductToSupplier,
  brandCocokUntukGame,
  normalizeLabel,
  supplierPrefix,
  withSkuLabels,
  type LabeledQuote,
  type MatchableProduct,
} from "../src/lib/suppliers/match.ts";
import type { SupplierQuote } from "../src/lib/suppliers/types.ts";

/**
 * Pencocokan SKU Melostore ke produk Nambah.
 *
 * Yang diuji di sini bukan cuma kasus eases: justru kasus yang membuat
 * pencocokan otomatis BERBAHAYA yang paling penting. 57 label identik
 * dipakai lebih dari satu produk Nambah, dan salah satunya
 * "10.000" - yang ada di Telkomsel, Indosat, Smartfren, Axis, dan By.u.
 *
 * Satu pasangan yang salah di sana berarti pembeli menerima top up
 * operator yang tidak ia beli.
 */

const produk = (
  id: string,
  label: string,
  gameId: string,
): MatchableProduct => ({ id, label, gameId });

const quote = (sku: string, skuLabel: string, cost = 1000): LabeledQuote => ({
  supplierId: "melostore",
  sku,
  cost,
  stock: null,
  skuLabel,
});

/* ==========================================================================
   Normalisasi label.
   ========================================================================== */

test("diamond dan diamonds dianggap sama", () => {
  assert.equal(normalizeLabel("50 Diamonds"), normalizeLabel("50 diamond"));
});

test("huruf besar, spasi, dan titik ribuan diabaikan", () => {
  assert.equal(normalizeLabel(" 1.200 Diamonds "), normalizeLabel("1200 Diamonds"));
});

test("label berbeda tetap berbeda", () => {
  assert.equal(normalizeLabel("50 Diamonds") === normalizeLabel("55 Diamonds"), false);
});

test("label kosong tidak crash", () => {
  assert.equal(normalizeLabel(""), "");
  assert.equal(normalizeLabel(undefined as unknown as string), "");
});

/* ==========================================================================
   Prefiks SKU.
   ========================================================================== */

test("prefiks SKU diambil dan dinormalisasi", () => {
  assert.equal(supplierPrefix("mlid28d-s1"), "mlid");
  assert.equal(supplierPrefix("FFG50DD-S4"), "ffg");
});

test("SKU tanpa prefiks huruf mengembalikan null", () => {
  assert.equal(supplierPrefix("123-abc"), null);
  assert.equal(supplierPrefix(""), null);
});

/* ==========================================================================
   Batas game.
   ========================================================================== */

test("game yang diizinkan punya prefiks", () => {
  assert.equal(isGameEligible("mobile-legends"), true);
  assert.equal(expectedPrefixes("mobile-legends").includes("mlid"), true);
});

test("pulsa dan e-wallet TIDAK diizinkan", () => {
  // "10.000" ada di lima operator. Melvii memetakannya secara otomatis
  // berartialsy Who knows.
  for (const id of ["telkomsel", "indosat", "axis", "byu", "smartfren", "dana"]) {
    assert.equal(isGameEligible(id), false, id + " seharusnya tidak diizinkan");
  }
});

test("game tak dikenal tidak diizinkan dan tidak punya prefiks", () => {
  assert.equal(isGameEligible("game-yang-tidak-ada"), false);
  assert.deepEqual(expectedPrefixes("game-yang-tidak-ada"), []);
});

/* ==========================================================================
   Magic Chess Go Go: allowlist dengan saringan BRAND (bukan prefiks).
   ========================================================================== */

test("magic-chess diizinkan; prefiks sengaja kosong - saringan via brand", () => {
  assert.equal(isGameEligible("magic-chess"), true);
  assert.deepEqual(
    expectedPrefixes("magic-chess"),
    [],
    "prefiks belum terkonfirmasi dari data - tebakan dilarang",
  );
});

test("magic-chess tanpa gameName tetap game-not-allowed (jalur lama aman)", () => {
  const hasil = matchProductToSupplier(
    produk("p-mcgg", "First Recharge 300 Diamonds", "magic-chess"),
    [
      {
        supplierId: "melostore",
        sku: "mcggfr300-s1",
        cost: 1000,
        stock: null,
        skuLabel: "First Recharge 300 Diamonds",
        brand: "Magic Chess Go Go",
      },
    ],
  );
  assert.equal(hasil.reason, "game-not-allowed");
  assert.equal(hasil.supplierSku, null);
});

test("magic-chess auto-map via brand alias 'Magic Chess Go Go'", () => {
  const hasil = matchProductToSupplier(
    {
      id: "p-mcgg",
      label: "First Recharge 300 Diamonds",
      gameId: "magic-chess",
      // Nama baris games Nambah tidak harus persis sama dengan brand katalog.
      gameName: "Magic Chess",
    },
    [
      {
        supplierId: "melostore",
        sku: "mcggfr300-s1",
        cost: 1000,
        stock: null,
        skuLabel: "First Recharge 300 Diamonds",
        brand: "Magic Chess Go Go",
      },
    ],
  );
  assert.equal(hasil.confidence, "exact");
  if (hasil.supplierSku !== null) {
    assert.equal(hasil.supplierSku, "mcggfr300-s1");
  }
});

test("brand game lain tidak menyusup lewat jalur brand", () => {
  const hasil = matchProductToSupplier(
    {
      id: "p-mcgg",
      label: "50 Diamonds",
      gameId: "magic-chess",
      gameName: "Magic Chess",
    },
    [
      {
        supplierId: "melostore",
        sku: "ffid50d-s7",
        cost: 1000,
        stock: null,
        skuLabel: "50 Diamonds",
        brand: "Free Fire",
      },
    ],
  );
  // Label cocok tapi brand bukan milik game ini -> tidak ada kandidat,
  // bukan pasangan salah.
  assert.equal(hasil.confidence, "none");
  assert.equal(hasil.supplierSku, null);
});

test("dua SKU brand sama -> ambiguous, bukan pilih termurah", () => {
  const hasil = matchProductToSupplier(
    {
      id: "p-mcgg",
      label: "50 Diamonds",
      gameId: "magic-chess",
      gameName: "Magic Chess",
    },
    [
      {
        supplierId: "melostore",
        sku: "mcgg50d-s1",
        cost: 900,
        stock: null,
        skuLabel: "50 Diamonds",
        brand: "Magic Chess Go Go",
      },
      {
        supplierId: "melostore",
        sku: "mcgg50d-s2",
        cost: 1200,
        stock: null,
        skuLabel: "50 Diamonds",
        brand: "Magic Chess",
      },
    ],
  );
  assert.equal(hasil.confidence, "ambiguous");
  assert.equal(hasil.supplierSku, null);
});

test("brandCocokUntukGame: nama game, short name, dan alias", () => {
  const produk = {
    id: "p",
    label: "x",
    gameId: "magic-chess",
    gameName: "Magic Chess",
    gameShortName: "MCGG",
  };
  assert.equal(brandCocokUntukGame("Magic Chess", produk), true);
  assert.equal(brandCocokUntukGame("MCGG", produk), true);
  assert.equal(brandCocokUntukGame("Magic Chess Go Go", produk), true);
  assert.equal(brandCocokUntukGame("magic chess gogo", produk), true);
  assert.equal(brandCocokUntukGame("Free Fire", produk), false);
  assert.equal(brandCocokUntukGame(null, produk), false);
  assert.equal(brandCocokUntukGame("", produk), false);
});

/* ==========================================================================
   Pasangan yang pasti benar.
   ========================================================================== */

test("label dan prefiks sama-sama cocok menghasilkan pasangan", () => {
  const hasil = matchProductToSupplier(
    produk("p1", "50 Diamonds", "free-fire"),
    [quote("ffg50dd-s4", "50 Diamonds", 6849)],
  );

  assert.equal(hasil.confidence, "exact");
  assert.equal(hasil.supplierSku, "ffg50dd-s4");
  assert.equal(hasil.supplierCost, 6849);
});

test("produk non-game ditolak dengan alasan yang jelas", () => {
  const hasil = matchProductToSupplier(
    produk("p1", "10.000", "telkomsel"),
    [quote("apa saja", "10.000")],
  );

  assert.equal(hasil.reason, "game-not-allowed");
  assert.equal(hasil.supplierSku, null);
});

/* ==========================================================================
   Kasus berbahaya: label sama, game berbeda.
   ========================================================================== */

test("pulsa tidak pernah dipetakan meski labelnya cocok persis", () => {
  // SKU Melostore untuk pulsa mungkin saja bernama "10.000". Kalau
  // pencocokan hanya melihat nama, ini akan terpasang.
  const hasil = matchProductToSupplier(
    produk("df-s10-telkomsel", "10.000", "telkomsel"),
    [quote("bysu10", "10.000", 9800)],
  );

  assert.equal(hasil.reason, "game-not-allowed");
  assert.equal(hasil.supplierSku, null);
});

test("produk game dengan label sama di game lain tidak tertukar", () => {
  // "1200 diamond" ada di Mobile Legends DAN Free Fire. SKU ML punya
  // prefiks ml, SKU FF punya prefiks ff - hanya prefiks yang
  // membedakan keduanya, dan itu wajib dipakai.
  const katalog = [
    quote("mlid1200d-s1", "1200 Diamonds", 150000),
    quote("ffid1200d-s7", "1200 Diamonds", 145000),
  ];

  const ml = matchProductToSupplier(produk("p-ml", "1200 Diamonds", "mobile-legends"), katalog);
  const ff = matchProductToSupplier(produk("p-ff", "1200 Diamonds", "free-fire"), katalog);

  assert.equal(ml.supplierSku, "mlid1200d-s1");
  assert.equal(ff.supplierSku, "ffid1200d-s7");
  assert.notEqual(ml.supplierSku, ff.supplierSku);
});

/* ==========================================================================
   Kasus berbahaya: beberapa SKU untuk satu label.
   ========================================================================== */

test("beberapa SKU wilayah untuk satu label tidak dipilih diam-diam", () => {
  // Melostore menjual "50 Diamonds" untuk Indonesia dan global dengan
  // SKU dan harga berbeda. Memilih yang termurah terlihat optimizes,
  // tapi order-nya masuk ke wilayah yang tidak diminta.
  const hasil = matchProductToSupplier(
    produk("p1", "50 Diamonds", "free-fire"),
    [
      quote("ffid50d-s7", "50 Diamonds", 6849),
      quote("ffg50dd-s4", "50 Diamonds", 6500),
    ],
  );

  assert.equal(hasil.confidence, "ambiguous");
  assert.equal(hasil.reason, "multiple-supplier-sku");
  assert.equal(hasil.supplierSku, null);
  // Kandidat tetap ditampilkan supaya operator bisa memilih manual.
  assert.equal(hasil.candidates.length, 2);
  assert.equal(hasil.candidates[0].cost, 6500);
});

test("satu SKU di wilayah berbeda TIDAK membuat hasil ambigu", () => {
  // Kalau prefiks memfilter, tersisa satu saja - itu aman dippasang.
  const hasil = matchProductToSupplier(
    produk("p1", "50 Diamonds", "mobile-legends"),
    [
      quote("mlid50d-s1", "50 Diamonds", 8700),
      quote("ffid50d-s7", "50 Diamonds", 6849),
    ],
  );

  assert.equal(hasil.confidence, "exact");
  assert.equal(hasil.supplierSku, "mlid50d-s1");
});

/* ==========================================================================
   Produk yang labelnya bentrok di sisi Nambah.
   ========================================================================== */

test("produk dengan label sama di Nambah dicatat sebagai konflik", () => {
  const hasil = matchProductToSupplier(
    produk("p-telkomsel", "10.000", "telkomsel"),
    [],
    {
      productsWithSameLabel: [
        produk("p-telkomsel", "10.000", "telkomsel"),
        produk("p-indosat", "10.000", "indosat"),
        produk("p-axis", "10.000", "axis"),
      ],
    },
  );

  assert.deepEqual(hasil.conflictingProductIds.sort(), ["p-axis", "p-indosat"]);
});

test("produk tunggal tidak punya konflik", () => {
  const hasil = matchProductToSupplier(
    produk("p1", "50 Diamonds", "free-fire"),
    [quote("ffid50d-s7", "50 Diamonds")],
    { productsWithSameLabel: [produk("p1", "50 Diamonds", "free-fire")] },
  );

  assert.deepEqual(hasil.conflictingProductIds, []);
});

/* ==========================================================================
   Label yang tidak ada.
   ========================================================================== */

test("label tidak ditemukan reported dengan kandidat mirip", () => {
  const hasil = matchProductToSupplier(
    produk("p1", "77 Diamonds", "free-fire"),
    [
      quote("ffid70d-s7", "70 Diamonds", 9000),
      quote("ffid220d-s7", "220 Diamonds", 28000),
    ],
  );

  assert.equal(hasil.reason, "label-not-found");
  assert.equal(hasil.supplierSku, null);
});

test("label dengan keterangan tambahan dicatat sebagai kandidat", () => {
  // Melostore menulis "28 Diamonds (Malaysia)", Nambah menulis
  // "28 Diamonds". Tidak sama persis, tapi layak dicatat.
  const hasil = matchProductToSupplier(
    produk("p1", "28 Diamonds", "mobile-legends"),
    [quote("mlmy28d-s1", "28 Diamonds (Malaysia)", 16779)],
  );

  assert.equal(hasil.reason, "label-not-found");
  assert.equal(hasil.candidates.length, 1);
});

test("katalog kosong tidak crash", () => {
  const hasil = matchProductToSupplier(produk("p1", "50 Diamonds", "free-fire"), []);
  assert.equal(hasil.reason, "no-candidate-supplier");
  assert.equal(hasil.supplierSku, null);
});

/* ==========================================================================
   withSkuLabels.
   ========================================================================== */

test("label ditempelkan ke quote berdasarkan SKU", () => {
  const mentah: SupplierQuote[] = [
    { supplierId: "melostore", sku: "ffid50d-s7", cost: 6849, stock: null },
  ];
  const labels = new Map([["ffid50d-s7", "50 Diamonds"]]);

  const hasil = withSkuLabels(mentah, labels);
  assert.equal(hasil[0].skuLabel, "50 Diamonds");
  assert.equal(hasil[0].cost, 6849);
});

test("SKU tanpa label dapat undefined, bukan error", () => {
  const mentah: SupplierQuote[] = [
    { supplierId: "melostore", sku: "tidak-ada", cost: 1, stock: null },
  ];
  const hasil = withSkuLabels(mentah, new Map());
  assert.equal(hasil[0].skuLabel, undefined);
});

/* ==========================================================================
   Determinisme.
   ========================================================================== */

test("hasil tidak berubah tergantung urutan katalog", () => {
  const katalog = [
    quote("ffg50dd-s4", "50 Diamonds", 6500),
    quote("ffid50d-s7", "50 Diamonds", 6849),
    quote("mlid50d-s1", "50 Diamonds", 8700),
  ];

  const a = matchProductToSupplier(
    produk("p1", "50 Diamonds", "free-fire"),
    katalog,
  );
  const b = matchProductToSupplier(
    produk("p1", "50 Diamonds", "free-fire"),
    [...katalog].reverse(),
  );

  // Urutan katalog tidak boleh mengubah kesimpulan. Kalau urutan dibalik
  // menghasilkan jawaban berbeda, sync yang sama akan menulis hasil
  // berbeda tergantung urutan respons API.
  assert.equal(a.confidence, b.confidence);
  assert.equal(a.reason, b.reason);
  assert.deepEqual(
    a.candidates.map((c) => c.sku),
    b.candidates.map((c) => c.sku),
  );
});

test("SKU game lain tidak membuat hasil jadi ambigu", () => {
  // Dua SKU Free Fire wilayah + satu SKU Mobile Legends. ML harus
  // tersaring prefiks, sehingga hasilnya tetap satu SKU FF.
  const hasil = matchProductToSupplier(
    produk("p1", "50 Diamonds", "mobile-legends"),
    [
      quote("ffg50dd-s4", "50 Diamonds", 6500),
      quote("ffid50d-s7", "50 Diamonds", 6849),
      quote("mlid50d-s1", "50 Diamonds", 8700),
    ],
  );

  assert.equal(hasil.confidence, "exact");
  assert.equal(hasil.supplierSku, "mlid50d-s1");
});