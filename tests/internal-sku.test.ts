import test from "node:test";
import assert from "node:assert/strict";

import {
  brandAlias,
  generateInternalSku,
  internalSkuWithSuffix,
  jenisFromSupplier,
  nominalFromLabel,
  normalizeProductLabel,
  regionFromSupplierSku,
  skuInternalBebas,
} from "../src/lib/internal-sku.ts";

/**
 * Generator SKU internal, format GAME-JENIS-NOMINAL.
 *
 * Contoh di spesifikasi adalah kontrak:
 *   Mobile Legends + 56 Diamonds -> MLBB-DM-56
 *   Free Fire + 70 Diamonds      -> FF-DM-70
 *   PUBG Mobile + 60 UC          -> PUBGM-UC-60
 * Dengan pembeda wilayah: MLBB-DM-56-ID dan MLBB-DM-56-MY.
 */

const sku = (
  gameId: string,
  label: string,
  opsi?: { jenis?: string; region?: string; supplierSku?: string },
) => generateInternalSku({ gameId, label, ...opsi }, opsi?.supplierSku);

/* ==========================================================================
   Contoh dari spesifikasi.
   ========================================================================== */

test("format GAME-JENIS-NOMINAL sesuai spesifikasi", () => {
  assert.equal(sku("mobile-legends", "56 Diamonds"), "MLBB-DM-56");
  assert.equal(sku("free-fire", "70 Diamonds"), "FF-DM-70");
  assert.equal(sku("pubg-mobile", "60 UC"), "PUBGM-UC-60");
});

test("kolom type supplier lebih diutamakan daripada nama", () => {
  // Nama supplier bisa menulis "56 Dm" - kolom type "Diamonds" adalah
  // sumber yang lebih rapi untuk jenis.
  assert.equal(
    sku("mobile-legends", "56 Dm", { jenis: "Diamonds" }),
    "MLBB-DM-56",
  );
});

/* ==========================================================================
   Tiga bagian terpisah: GAME, JENIS, NOMINAL.
   ========================================================================== */

test("game berbeda, nominal sama -> SKU berbeda", () => {
  const ml = sku("mobile-legends", "50 Diamonds");
  const ff = sku("free-fire", "50 Diamonds");
  assert.equal(ml, "MLBB-DM-50");
  assert.equal(ff, "FF-DM-50");
  assert.notEqual(ml, ff);
});

test("nominal berbeda, game sama -> SKU berbeda", () => {
  assert.notEqual(sku("mobile-legends", "50 Diamonds"), sku("mobile-legends", "56 Diamonds"));
});

test("penulisan nama berbeda untuk barang sama -> SKU sama", () => {
  // "50 Diamonds", "50 diamond", dan "50 Diamonds " adalah barang yang
  // sama. Kalau SKU-nya berbeda, scan ulang akan membuat produk duplikat.
  assert.equal(sku("mobile-legends", "50 Diamonds"), sku("mobile-legends", "50 diamond"));
  assert.equal(sku("mobile-legends", "50 Diamonds"), sku("mobile-legends", "  50 diamonds  "));
});

/* ==========================================================================
   Region.
   ========================================================================== */

test("wilayah utama tidak diberi akhiran", () => {
  // mlid = Indonesia, pasar utama. Akhiran hanya untuk yang menyimpang.
  assert.equal(sku("mobile-legends", "56 Diamonds", { supplierSku: "mlid56d-s1" }), "MLBB-DM-56");
});

test("wilayah lain diberi akhiran", () => {
  assert.equal(
    sku("mobile-legends", "56 Diamonds", { supplierSku: "mlmy56d-s1" }),
    "MLBB-DM-56-MY",
  );
  assert.equal(
    sku("free-fire", "70 Diamonds", { supplierSku: "ffg70d-s5" }),
    "FF-DM-70-GL",
  );
});

test("produk Digiflazz (tanpa region di SKU) tanpa akhiran", () => {
  // SKU Digiflazz opaque (pre34157843) - tidak ada informasi wilayah,
  // jadi tanpa akhiran. Menebak wilayah dari nama berarti mengarang.
  assert.equal(sku("mobile-legends", "56 Diamonds", { supplierSku: "pre34157843" }), "MLBB-DM-56");
});

test("region eksplisit menimpa tebakan dari SKU supplier", () => {
  assert.equal(
    sku("mobile-legends", "56 Diamonds", { supplierSku: "mlmy56d-s1", region: "ID" }),
    "MLBB-DM-56",
  );
});

/* ==========================================================================
   Region dari prefiks RAKUS vs STARTS WITH - regresi bug FTU Malaysia.

   Ekstraksi `^([a-z]+)` membaca "mlmyfr100d-s2" sebagai prefiks "mlmyfr"
   yang tidak ada di daftar - wilayah lenyap, SKU turunan kehilangan
   akhiran -MY, dan FTU Malaysia cocok ke produk diamond reguler
   Indonesia. Terbukti di uji nyata: 7 pemetaan salah terpasang.
   ========================================================================== */

test("prefiks dengan huruf lanjutan tetap terbaca region (mlmyfr...)", () => {
  assert.equal(regionFromSupplierSku("mlmyfr100d-s2"), "MY");
  assert.equal(regionFromSupplierSku("mlphftu100d-s12"), "PH");
  assert.equal(regionFromSupplierSku("ffgevent70d-s3"), "GL");
});

test("SKU FTU Malaysia membawa akhiran -MY, bukan menyamar sebagai Indonesia", () => {
  // Regresi langsung dari kasus nyata: tanpa akhiran, item ini cocok ke
  // produk "50 Diamond" Indonesia yang sama sekali bukan barangnya.
  assert.equal(
    sku("mobile-legends", "First Top Up 50+Bonus Diamonds (Malaysia)", {
      supplierSku: "mlmyfr100d-s2",
    }),
    "MLBB-DM-50-MY",
  );
});

test("prefiks terpanjang diperiksa lebih dulu (pubgmgl bukan pubgm)", () => {
  assert.equal(regionFromSupplierSku("pubgmgl60uc-s1"), "GL");
  assert.equal(regionFromSupplierSku("pubgmid60uc-s1"), null);
});

/* ==========================================================================
   Ekstraksi nominal.
   ========================================================================== */

test("pemisah ribuan gaya Indonesia dihilangkan", () => {
  assert.equal(sku("mobile-legends", "1.050 Diamonds"), "MLBB-DM-1050");
  assert.equal(nominalFromLabel("1.000.000 UC"), 1000000);
});

test("angka terbesar yang dipakai, bukan yang pertama", () => {
  // "2x 50 Diamonds" menyebut dua angka; yang mengidentifikasi produk
  // adalah 50, bukan pengali 2.
  assert.equal(nominalFromLabel("2x 50 Diamonds"), 50);
});

test("angka desimal bukan pemisah ribuan", () => {
  assert.equal(nominalFromLabel("12.5 Diamonds"), 12);
});

/* ==========================================================================
   Produk tanpa nominal.
   ========================================================================== */

test("produk tanpa angka memakai sisa nama sebagai bagian NOMINAL", () => {
  // "Weekly Pass" tidak punya angka. Tanpa jalur ini, produk non-top-up
  // tidak punya cara masuk ke format GAME-JENIS-NOMINAL sama sekali.
  assert.equal(sku("mobile-legends", "Weekly Pass"), "MLBB-WEEKLY-PASS");
});

test("kata jenis dikeluarkan dari sisa nama, tidak dobel", () => {
  assert.equal(sku("mobile-legends", "Weekly Diamond Pass"), "MLBB-WEEKLY-PASS");
});

test("jenis tak dikenal jatuh ke ITEM, bukan gagal", () => {
  assert.equal(sku("mobile-legends", "Special Bundle"), "MLBB-BUNDLE-SPECIAL");
});

/* ==========================================================================
   jenisFromSupplier.
   ========================================================================== */

test("jenis dikenali dari kata tunggal maupun jamak", () => {
  assert.equal(jenisFromSupplier("Diamonds", null), "DM");
  assert.equal(jenisFromSupplier("Diamond", null), "DM");
  assert.equal(jenisFromSupplier("UC", null), "UC");
  assert.equal(jenisFromSupplier(null, "125 Points"), "PT");
});

test("jenis yang tidak dikenal mengembalikan null", () => {
  assert.equal(jenisFromSupplier("Mystery Box", null), null);
  assert.equal(jenisFromSupplier(null, null), null);
});

/* ==========================================================================
   Stabilitas.
   ========================================================================== */

test("SKU tidak bergantung pada SKU supplier yang berbeda untuk barang sama", () => {
  // Digiflazz "pre34157843" dan Melostore "mlid56d-s1" adalah barang yang
  // sama. SKU internal harus sama - itulah yang menghubungkan keduanya.
  const dariDigiflazz = sku("mobile-legends", "56 Diamonds", { supplierSku: "pre34157843" });
  const dariMelostore = sku("mobile-legends", "56 Diamonds", { supplierSku: "mlid56d-s1" });
  assert.equal(dariDigiflazz, dariMelostore);
});

test("input kosong tidak menghasilkan SKU", () => {
  assert.equal(sku("mobile-legends", ""), null);
  assert.equal(sku("mobile-legends", "   "), null);
});

test("SKU tidak melebihi batas yang masuk akal", () => {
  const panjang = sku(
    "game-tanpa-alias-yang-sangat-panjang",
    "Nama Produk Yang Sangat Panjang ".repeat(6),
  );
  if (panjang !== null) assert.ok(panjang.length <= 120);
});

/* ==========================================================================
   Alias brand.
   ========================================================================== */

test("alias brand untuk game besar", () => {
  assert.equal(brandAlias("mobile-legends"), "MLBB");
  assert.equal(brandAlias("free-fire"), "FF");
  assert.equal(brandAlias("pubg-mobile"), "PUBGM");
});

test("alias tidak pernah mengandung tanda hubung", () => {
  // Tanda hubung adalah pemisah bagian SKU. Kalau alias memakainya,
  // SKU tidak bisa dipecah kembali.
  for (const game of ["mobile-legends", "free-fire", "call-of-duty-mobile"]) {
    assert.equal(brandAlias(game).includes("-"), false, game);
  }
});

/* ==========================================================================
   Akhiran duplikat.
   ========================================================================== */

test("akhiran menghasilkan SKU unik dari dasar sama", () => {
  const input = { gameId: "mobile-legends", label: "56 Diamonds" };
  assert.equal(generateInternalSku(input), "MLBB-DM-56");
  assert.equal(internalSkuWithSuffix(input, 2), "MLBB-DM-56-2");
});

test("akhiran di bawah 2 ditolak", () => {
  const input = { gameId: "mobile-legends", label: "56 Diamonds" };
  assert.equal(internalSkuWithSuffix(input, 1), null);
  assert.equal(internalSkuWithSuffix(input, 0), null);
});

test("region dan akhiran bisa bersama", () => {
  const input = {
    gameId: "mobile-legends",
    label: "56 Diamonds",
    region: "MY",
  };
  assert.equal(internalSkuWithSuffix(input, 2), "MLBB-DM-56-MY-2");
});

/* ==========================================================================
   SKU internal vs SKU supplier.
   ========================================================================== */

test("SKU internal berbeda bentuk dari SKU supplier", () => {
  // Digiflazz memakai kode opaque, Melostore memakai prefiks kecil.
  // SKU internal huruf besar berformat tiga bagian - tidak mungkin
  // tertukar dengan keduanya.
  const internal = sku("mobile-legends", "56 Diamonds", { supplierSku: "mlid56d-s1" });
  assert.equal(internal, "MLBB-DM-56");
  assert.notEqual(internal, "mlid56d-s1");
  assert.notEqual(internal, "pre34157843");
});

/* ==========================================================================
   normalizeProductLabel - dipertahankan untuk pencocokan.
   ========================================================================== */

test("normalisasi label untuk pencocokan tetap bekerja", () => {
  assert.equal(normalizeProductLabel("50 Diamonds"), "50diamonds");
  assert.equal(normalizeProductLabel("1.050 Diamonds"), "1050diamonds");
  assert.equal(normalizeProductLabel(""), "");
});

/* ==========================================================================
   skuInternalBebas - SKU pertama yang masih bebas dari bentrok.
   ========================================================================== */

test("SKU dasar dipakai kalau belum ada yang memakai", () => {
  const hasil = skuInternalBebas(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    new Set(),
  );
  assert.equal(hasil, "MLBB-DM-56");
});

test("bentrok dengan SKU dasar menghasilkan akhiran -2", () => {
  const hasil = skuInternalBebas(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    new Set(["MLBB-DM-56"]),
  );
  assert.equal(hasil, "MLBB-DM-56-2");
});

test("bentrok berantai melompat ke akhiran berikutnya yang bebas", () => {
  const hasil = skuInternalBebas(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    new Set(["MLBB-DM-56", "MLBB-DM-56-2", "MLBB-DM-56-3"]),
  );
  assert.equal(hasil, "MLBB-DM-56-4");
});

test("48 akhiran penuh mengembalikan null, bukan SKU bentrok", () => {
  const dipakai = new Set(["MLBB-DM-56"]);
  for (let suffix = 2; suffix < 50; suffix += 1) {
    dipakai.add(`MLBB-DM-56-${suffix}`);
  }
  const hasil = skuInternalBebas(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    dipakai,
  );
  assert.equal(hasil, null);
});

test("label kosong mengembalikan null tanpa menyentuh daftar", () => {
  const hasil = skuInternalBebas({ gameId: "mobile-legends", label: "  " }, new Set());
  assert.equal(hasil, null);
});

test("wilayah ikut membedakan SKU dasar sebelum akhiran dipakai", () => {
  // mlgl -> region GL, jadi SKU dasarnya sendiri berbeda dari varian ID.
  const hasilGl = skuInternalBebas(
    { gameId: "mobile-legends", label: "56 Diamonds", supplierSku: "mlgl56d-s1" },
    new Set(["MLBB-DM-56"]),
  );
  assert.equal(hasilGl, "MLBB-DM-56-GL");
});