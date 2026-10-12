import test from "node:test";
import assert from "node:assert/strict";

import {
  gabungkanKandidat,
  gameCocokUntukProduk,
  urutkanKandidatMelostore,
  type KandidatMelostore,
} from "../src/lib/suppliers/saran-sku.ts";

/**
 * Peringkat kandidat Melostore di combobox editor katalog.
 *
 * Spesifikasi perilaku: kalau tidak ada auto-map, combobox harus
 * menampilkan pilihan yang MENDEKATI produk - bukan kotak kosong, bukan
 * katalog utuh. Barang setara dengan nama beda tulis ("56 Diamond" vs
 * "56 Diamonds (Event)") harus muncul, sedangkan barang game/nominal
 * lain tidak.
 *
 * ATURAN IDENTITAS GAME (nominal sama TIDAK cukup):
 * - Game dikenal (punya prefiks): SKU harus berawalan prefiks game itu.
 * - Game tanpa prefiks (hasil "buat otomatis dari brand"): SKU harus
 *   ber-brand yang sama dengan nama game. Tanpa ini, produk game baru
 *   tidak pernah bisa diberi saran meski barangnya ada di katalog.
 */

const q = (sku: string, name: string, cost: number, brand?: string | null) => ({
  sku,
  name,
  cost,
  ...(brand !== undefined ? { brand } : {}),
});

test("nama sama persis masuk tingkat COCOK", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [q("mlid56d-s1", "56 Diamonds", 8695)],
  );

  assert.equal(hasil.tepat.length, 1);
  assert.equal(hasil.tepat[0].sku, "mlid56d-s1");
  assert.equal(hasil.mendekati.length, 0);
});

test("huruf besar dan jamak tidak menghalangi tingkat COCOK", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 diamond" },
    [q("mlid56d-s1", "56 Diamonds", 8695)],
  );

  assert.equal(hasil.tepat.length, 1);
});

test("nama beda tulis tapi nominal dan game sama masuk MENDEKATI", () => {
  // Kasus nyata: Digiflazz menyebut "56 Diamond", Melostore "56 Diamonds
  // (Event)". Nama tidak sama persis, barangnya sama.
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [q("mlid56de-s1", "56 Diamonds (Event)", 8700)],
  );

  assert.equal(hasil.tepat.length, 0);
  assert.equal(hasil.mendekati.length, 1);
  assert.equal(hasil.mendekati[0].sku, "mlid56de-s1");
});

test("nominal berbeda TIDAK masuk saran", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [q("mlid50d-s1", "50 Diamonds", 8000)],
  );

  assert.equal(hasil.tepat.length, 0);
  assert.equal(hasil.mendekati.length, 0);
});

test("prefiks game berbeda TIDAK masuk saran", () => {
  // ffid50d adalah Free Fire 50 Diamonds - nominal sama, game berbeda.
  // Menyarankannya akan mempercepat salah kirim ke game yang salah.
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "50 Diamonds" },
    [q("ffid50d-s7", "50 Diamonds", 6250)],
  );

  assert.equal(hasil.tepat.length, 0);
  assert.equal(hasil.mendekati.length, 0);
});

test("prefiks ff termasuk free-fire, walaupun berlapis wilayah", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "free-fire", label: "50 Diamonds" },
    [q("ffg50dd-s4", "50 Diamonds", 6500)],
  );

  assert.equal(hasil.tepat.length, 1);
});

test("varian wilayah membawa tandanya sendiri", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [q("mlmy56d-s1", "56 Diamonds", 9100)],
  );

  const semua = gabungkanKandidat(hasil);
  assert.equal(semua.length, 1);
  assert.equal(semua[0].region, "MY");
});

test("wilayah utama tidak membawa tanda", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [q("mlid56d-s1", "56 Diamonds", 8695)],
  );

  assert.equal(gabungkanKandidat(hasil)[0].region, null);
});

test("termurah muncul lebih dulu di dalam tiap tingkat", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [
      q("mlid56de-s1", "56 Diamonds (Event)", 8700),
      q("mlid56de-s2", "56 Diamonds (Bonus)", 8600),
    ],
  );

  assert.equal(hasil.mendekati[0].cost, 8600);
  assert.equal(hasil.mendekati[1].cost, 8700);
});

test("gabungan menaruh COCOK sebelum MENDEKATI, seberapa pun harganya", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [
      q("mlid56de-s1", "56 Diamonds (Event)", 1000),
      q("mlid56d-s1", "56 Diamonds", 8695),
    ],
  );

  const gabung = gabungkanKandidat(hasil);
  assert.equal(gabung[0].exact, true);
  assert.equal(gabung[0].sku, "mlid56d-s1");
  assert.equal(gabung[1].exact, false);
});

test("semua kandidat membawa harga dan nama untuk diputuskan", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [q("mlid56de-s1", "56 Diamonds (Event)", 8700)],
  );

  const kandidat: KandidatMelostore = gabungkanKandidat(hasil)[0];
  assert.equal(kandidat.name, "56 Diamonds (Event)");
  assert.equal(kandidat.cost, 8700);
  assert.ok(kandidat.sku.length > 0);
});

test("produk tanpa nominal: hanya COCOK, tanpa tebakan mendekati", () => {
  // "Weekly Pass" tidak punya angka - tidak ada dasar mengatakan kandidat
  // mana yang "sama nominal". Menyerahkan ke pencarian manual itu jujur.
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "Weekly Pass" },
    [
      q("mlidpass-s1", "Weekly Pass", 19000),
      q("mlid56d-s1", "56 Diamonds", 8695),
    ],
  );

  assert.equal(hasil.tepat.length, 1);
  assert.equal(hasil.mendekati.length, 0);
});



test("katalog kosong menghasilkan daftar kosong, bukan error", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    [],
  );

  assert.deepEqual(hasil.tepat, []);
  assert.deepEqual(hasil.mendekati, []);
});

test("katalog besar tidak membuat tingkat membengkak", () => {
  const katalog = Array.from({ length: 200 }, (_, i) =>
    q(`mlid56de-${i}`, `56 Diamonds (Varian ${i})`, 8000 + i),
  );
  const hasil = urutkanKandidatMelostore(
    { gameId: "mobile-legends", label: "56 Diamonds" },
    katalog,
  );

  assert.ok(hasil.mendekati.length <= 10);
  assert.ok(hasil.tepat.length <= 10);
});

/* ==========================================================================
   Identitas game via BRAND - untuk game tanpa prefiks dikenal.

   Kasus nyata: produk "100800 IDR" di game roblox-idr ("Roblox (Idr)",
   hasil "buat otomatis dari brand"). SKU "rgc..." tidak punya prefiks
   dikenal; satu-satunya identitasnya adalah brand "Roblox (IDR)".
   ========================================================================== */

test("game tanpa prefiks: kandidat ber-brand sama tetap muncul", () => {
  const hasil = urutkanKandidatMelostore(
    {
      gameId: "roblox-idr",
      gameName: "Roblox (Idr)",
      label: "100800 IDR",
    },
    [
      q("rgciid100800io-s7", "100800 IDR", 155000, "Roblox (IDR)"),
      q("rgciid50400io-s7", "50400 IDR", 78000, "Roblox (IDR)"),
    ],
  );

  // Nama sama persis -> tingkat COCOK; nominal beda -> tidak disarankan.
  assert.equal(hasil.tepat.length, 1);
  assert.equal(hasil.tepat[0].sku, "rgciid100800io-s7");
});

test("game tanpa prefiks: nominal sama ber-brand sama masuk MENDEKATI", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "mongil-star-dive", gameName: "Mongil: Star Dive", label: "60 Gems" },
    [q("mongil60g-s1", "60 Gems (Event)", 9000, "MONGIL: STAR DIVE")],
  );

  assert.equal(hasil.tepat.length, 0);
  assert.equal(hasil.mendekati.length, 1);
  assert.equal(hasil.mendekati[0].sku, "mongil60g-s1");
});

test("game tanpa prefiks: brand beda tidak pernah muncul walau nominal sama", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "roblox-idr", gameName: "Roblox (Idr)", label: "100800 IDR" },
    [
      // Nominal sama persis, tapi barang Netflix - menawarkannya hanya
      // mempercepat salah kirim.
      q("nfx100800-s1", "100800 IDR", 150000, "Netflix (AE)"),
    ],
  );

  assert.equal(hasil.tepat.length, 0);
  assert.equal(hasil.mendekati.length, 0);
});

test("game tanpa prefiks: brand tanpa kurung tidak menyamarkan varian", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "roblox-idr", gameName: "Roblox (Idr)", label: "100800 IDR" },
    [
      // Strict: "Roblox" != "Roblox (Idr)" - perbandingan TANPA
      // mengupas tanda kurung, supaya varian (Global)/(EUR) tidak
      // menyusup ke game varian lain.
      q("rbc100800-s1", "100800 IDR", 150000, "Roblox"),
    ],
  );

  assert.equal(hasil.tepat.length, 0);
  assert.equal(hasil.mendekati.length, 0);
});

test("game dikenal tetap lewat prefiks, brand tidak dipakai", () => {
  const hasil = urutkanKandidatMelostore(
    { gameId: "free-fire", gameName: "Free Fire", label: "50 Diamonds" },
    [
      // Prefiks ff = Free Fire -> lolos via prefiks walau brand beda tulis.
      q("ffid50d-s7", "50 Diamonds", 6250, "Free Fire (ID)"),
      // Bukan prefiks Free Fire -> tidak muncul walau brand mengandung nama.
      q("nfx50-s1", "50 Diamonds", 7000, "Free Fire (Netflix Edisi)"),
    ],
  );

  assert.equal(hasil.tepat.length, 1);
  assert.equal(hasil.tepat[0].sku, "ffid50d-s7");
});

test("gameCocokUntukProduk: saring hasil ketik per game", () => {
  const produkML = { gameId: "mobile-legends", gameName: "Mobile Legends", label: "56 Diamonds" };
  // Prefiks benar -> true; prefiks FF -> false walau nominal sama.
  assert.equal(gameCocokUntukProduk(produkML, { sku: "mlid56d-s1" }), true);
  assert.equal(gameCocokUntukProduk(produkML, { sku: "ffid56d-s7" }), false);

  const produkRoblox = { gameId: "roblox-idr", gameName: "Roblox (Idr)", label: "100800 IDR" };
  // Brand cocok -> true; brand lain -> false; tanpa brand -> false.
  assert.equal(
    gameCocokUntukProduk(produkRoblox, { sku: "rgciid100800io-s7", brand: "Roblox (IDR)" }),
    true,
  );
  assert.equal(
    gameCocokUntukProduk(produkRoblox, { sku: "rgciid100800io-s7", brand: "Netflix (AE)" }),
    false,
  );
  assert.equal(gameCocokUntukProduk(produkRoblox, { sku: "rgciid100800io-s7" }), false);
});