import test from "node:test";
import assert from "node:assert/strict";

import {
  brandAlias,
  generateInternalSku,
  internalSkuWithSuffix,
  normalizeProductLabel,
} from "../src/lib/internal-sku.ts";

/**
 * Generator SKU internal.
 *
 * Contoh di spesifikasi adalah kontrak, bukan contoh:
 *   Mobile Legends + "50 Diamond"          -> MLBB-50-DIAMOND
 *   Free Fire + "100 Diamond"              -> FF-100-DIAMOND
 *   PUBG Mobile + "60 UC"                  -> PUBGM-60-UC
 *   Genshin Impact + "60 Genesis Crystals" -> GI-60-GENESIS-CRYSTALS
 *   Valorant + "125 Points"                -> VALORANT-125-POINTS
 */

test("contoh dari spesifikasi menghasilkan SKU yang persis", () => {
  assert.equal(generateInternalSku("mobile-legends", "50 Diamond"), "MLBB-50-DIAMOND");
  assert.equal(generateInternalSku("mobile-legends", "100 Diamond"), "MLBB-100-DIAMOND");
  assert.equal(generateInternalSku("free-fire", "100 Diamond"), "FF-100-DIAMOND");
  assert.equal(generateInternalSku("pubg-mobile", "60 UC"), "PUBGM-60-UC");
  assert.equal(
    generateInternalSku("genshin-impact", "60 Genesis Crystals"),
    "GI-60-GENESIS-CRYSTALS",
  );
  assert.equal(generateInternalSku("valorant", "125 Points"), "VALORANT-125-POINTS");
});

/* ==========================================================================
   Normalisasi label.
   ========================================================================== */

test("huruf besar dan pemisah tanda hubung", () => {
  assert.equal(normalizeProductLabel("50 diamond"), "50-DIAMOND");
  assert.equal(normalizeProductLabel("  Weekly Pass  "), "WEEKLY-PASS");
});

test("pemisah ribuan gaya Indonesia dihilangkan, bukan jadi tanda hubung", () => {
  // "1.050" adalah seribu lima puluh. Membiarkan titiknya menghasilkan
  // "1-050-DIAMONDS" yang terbaca sebagai dua angka berbeda.
  assert.equal(normalizeProductLabel("1.050 Diamonds"), "1050-DIAMONDS");
  assert.equal(normalizeProductLabel("1.000.000 UC"), "1000000-UC");
});

test("angka desimal tetap memakai tanda hubung, bukan dihapus", () => {
  // "12.5" bukan ribuan - hanya pola tiga digit yang dihilangkan.
  assert.equal(normalizeProductLabel("12.5 Diamonds"), "12-5-DIAMONDS");
});

test("karakter khusus menjadi tanda hubung, tumpukan disatukan", () => {
  assert.equal(normalizeProductLabel("50 // Diamonds"), "50-DIAMONDS");
  assert.equal(normalizeProductLabel("50 -- Diamonds"), "50-DIAMONDS");
});

test("tanda hubung di awal dan akhir dibuang", () => {
  assert.equal(normalizeProductLabel("--50--"), "50");
});

test("jamak TIDAK dijamankan menjadi tunggal", () => {
  // Spesifikasi memakai "60 Genesis Crystals" utuh. Menyatukan Diamond
  // dan Diamonds justru membuat SKU tidak cocok dengan label yang
  // ditampilkan di katalog.
  assert.equal(normalizeProductLabel("60 Genesis Crystals"), "60-GENESIS-CRYSTALS");
});

test("label kosong menghasilkan string kosong", () => {
  assert.equal(normalizeProductLabel(""), "");
  assert.equal(normalizeProductLabel("   "), "");
  assert.equal(normalizeProductLabel("---"), "");
});

/* ==========================================================================
   Alias brand.
   ========================================================================== */

test("game besar memakai alias yang sudah dikenal", () => {
  assert.equal(brandAlias("mobile-legends"), "MLBB");
  assert.equal(brandAlias("free-fire"), "FF");
  assert.equal(brandAlias("pubg-mobile"), "PUBGM");
});

test("game tanpa alias turun ke slug dengan garis bawah", () => {
  // Panjang, tapi deterministik dan tidak memakai tanda hubung di dalam
  // bagian brand - tanda hubung adalah pemisah antar bagian SKU.
  assert.equal(brandAlias("call-of-duty-mobile"), "CODM");
  assert.equal(brandAlias("game-tak-terdaftar"), "GAME_TAK_TERDAFTAR");
});

test("alias tidak pernah mengandung tanda hubung", () => {
  // Tanda hubung adalah pemisah bagian. Kalau alias mengandungnya,
  // SKU tidak bisa dipecah kembali menjadi brand dan nama produk.
  for (const game of ["mobile-legends", "free-fire", "game-tak-terdaftar"]) {
    assert.equal(brandAlias(game).includes("-"), false, game);
  }
});

test("game id kosong tetap punya fallback yang aman", () => {
  assert.equal(brandAlias(""), "PRODUK");
});

/* ==========================================================================
   SKU utuh.
   ========================================================================== */

test("SKU internal TIDAK sama dengan SKU supplier", () => {
  // SKU Digiflazz untuk ML 50 Diamond adalah "ml50" atau sejenisnya;
  // SKU internal harus jelas berbeda supaya tidak tertukar saat
  // dikirim ke supplier.
  const internal = generateInternalSku("mobile-legends", "50 Diamond");
  assert.equal(internal, "MLBB-50-DIAMOND");
  assert.notEqual(internal, "ml50");
  assert.notEqual(internal?.toLowerCase(), "ml50");
});

test("label kosong tidak menghasilkan SKU", () => {
  // Mengarang SKU dari input kosong berarti membuat identitas yang
  // tidak bisa dilacak kembali ke produknya.
  assert.equal(generateInternalSku("mobile-legends", ""), null);
  assert.equal(generateInternalSku("mobile-legends", "   "), null);
  assert.equal(generateInternalSku("mobile-legends", "---"), null);
});

test("SKU yang sama dihasilkan untuk input yang setara", () => {
  const a = generateInternalSku("mobile-legends", "50  Diamonds");
  const b = generateInternalSku("mobile-legends", "50 Diamonds");
  assert.equal(a, b);
});

test("SKU untuk game berbeda berbeda, walau labelnya sama", () => {
  const ml = generateInternalSku("mobile-legends", "50 Diamond");
  const ff = generateInternalSku("free-fire", "50 Diamond");
  assert.notEqual(ml, ff);
});

test("SKU tidak melebihi batas yang masuk akal", () => {
  const panjang = generateInternalSku(
    "game-tanpa-alias-yang-sangat-panjang-sekali",
    "Nama Produk Yang Sangat Panjang ".repeat(6),
  );
  if (panjang !== null) {
    assert.ok(panjang.length <= 120, "SKU terlalu panjang: " + panjang.length);
  }
});

/* ==========================================================================
   Akhiran untuk duplikat.
   ========================================================================== */

test("akhiran menghasilkan SKU unik dari dasar yang sama", () => {
  const dasar = generateInternalSku("mobile-legends", "50 Diamond");
  const kedua = internalSkuWithSuffix("mobile-legends", "50 Diamond", 2);

  assert.equal(dasar, "MLBB-50-DIAMOND");
  assert.equal(kedua, "MLBB-50-DIAMOND-2");
  assert.notEqual(dasar, kedua);
});

test("akhiran di bawah 2 ditolak", () => {
  // Produk pertama tidak butuh akhiran; "-1" hanya menambah kebisingan.
  assert.equal(internalSkuWithSuffix("mobile-legends", "50 Diamond", 1), null);
  assert.equal(internalSkuWithSuffix("mobile-legends", "50 Diamond", 0), null);
  assert.equal(internalSkuWithSuffix("mobile-legends", "50 Diamond", -3), null);
});

test("akhiran bertingkat tetap unik", () => {
  const kumpulan = [2, 3, 4].map((n) =>
    internalSkuWithSuffix("free-fire", "100 Diamond", n),
  );
  assert.equal(new Set(kumpulan).size, kumpulan.length);
});