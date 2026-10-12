import test from "node:test";
import assert from "node:assert/strict";

import {
  buatGameBaruDefaults,
  butuhServerDariForm,
  cariGameCocok,
  inferKategori,
  makeInitials,
  normalizeText,
  slugify,
  stableAccent,
  titleCase,
} from "../src/lib/game-defaults.ts";

/**
 * Dasar-dasar baris game baru dari brand katalog supplier.
 *
 * Kontrak penting: id deterministik (brand sama -> slug sama, di semua
 * server), requires_server disimpulkan dari inquiry form (bukan nama
 * game), dan game yang sudah ada tidak pernah diduplikasi.
 */

test("slugify: brand katalog menjadi id game", () => {
  assert.equal(slugify("MONGIL: STAR DIVE"), "mongil-star-dive");
  assert.equal(slugify("Free Fire (Global)"), "free-fire-global");
  assert.equal(slugify("  Roblox   (USD)  "), "roblox-usd");
});

test("slugify: hanya tanda baca menghasilkan string kosong", () => {
  assert.equal(slugify(":::"), "");
  assert.equal(slugify("   "), "");
});

test("titleCase: kapital hanya di awal kata", () => {
  assert.equal(titleCase("MONGIL: STAR DIVE"), "Mongil: Star Dive");
  assert.equal(titleCase("free fire global"), "Free Fire Global");
});

test("titleCase: huruf setelah tanda baca ikut dikapital", () => {
  assert.equal(titleCase("Free Fire (Global)"), "Free Fire (Global)");
  assert.equal(titleCase("ROBLOX (USD)"), "Roblox (Usd)");
});

test("normalizeText menyatukan spasi dan tanda baca", () => {
  assert.equal(normalizeText("Free  Fire (Global)"), "free fire global");
  assert.equal(normalizeText("Mobile-Legends"), "mobile legends");
});

test("inferKategori: hanya kategori yang menyebut game", () => {
  assert.equal(inferKategori("Game"), "game");
  assert.equal(inferKategori("Gift Card"), "voucher");
  assert.equal(inferKategori("Social"), "voucher");
  assert.equal(inferKategori("Ewallet"), "voucher");
});

test("butuhServerDariForm: field kedua zone/server berarti butuh", () => {
  assert.equal(
    butuhServerDariForm([
      { key: "target_id", name: "Player ID", type: "text" },
      { key: "target_zone", name: "Zone", type: "text" },
    ]),
    true,
  );
  assert.equal(
    butuhServerDariForm([
      { key: "customer_target", name: "UID", type: "text" },
      { key: "server", name: "Server ID", type: "text" },
    ]),
    true,
  );
});

test("butuhServerDariForm: satu field berarti tidak butuh server", () => {
  assert.equal(
    butuhServerDariForm([{ key: "target_id", name: "Player ID", type: "text" }]),
    false,
  );
  assert.equal(butuhServerDariForm(null), false);
  assert.equal(butuhServerDariForm([]), false);
});

test("butuhServerDariForm: field kedua tanpa zona berarti tidak butuh server", () => {
  // Form login+password: dua field, tapi keduanya additional_data,
  // bukan server.
  assert.equal(
    butuhServerDariForm([
      { key: "login", name: "Login", type: "text" },
      { key: "password", name: "Password", type: "password" },
    ]),
    false,
  );
});

test("cariGameCocok: cocok lewat slug, nama, dan short_name", () => {
  const games = [
    { id: "free-fire", name: "Free Fire", short_name: "FF" },
    { id: "mlbb", name: "Mobile Legends", short_name: "ML" },
  ];
  assert.equal(cariGameCocok("Free Fire", games)?.id, "free-fire");
  assert.equal(cariGameCocok("mobile legends", games)?.id, "mlbb");
  assert.equal(cariGameCocok("ML", games)?.id, "mlbb");
});

test("cariGameCocok: brand varian tidak menyamar jadi game dasar", () => {
  const games = [{ id: "free-fire", name: "Free Fire", short_name: "FF" }];
  // "Free Fire (Global)" adalah brand berbeda - tidak boleh cocok
  // dengan "Free Fire" (operator yang mau menggabungkan memilih manual).
  assert.equal(cariGameCocok("Free Fire (Global)", games), null);
});

test("cariGameCocok: brand kosong menghasilkan null", () => {
  assert.equal(cariGameCocok("", [{ id: "x", name: "X", short_name: "X" }]), null);
});

test("buatGameBaruDefaults: brand lengkap menghasilkan baris siap insert", () => {
  const d = buatGameBaruDefaults({
    brand: "MONGIL: STAR DIVE",
    kategoriKatalog: "Game",
    fieldsForm: [{ key: "login", name: "Login", type: "text" }],
  });
  assert.ok(d);
  assert.equal(d.id, "mongil-star-dive");
  assert.equal(d.name, "Mongil: Star Dive");
  assert.equal(d.category, "game");
  assert.equal(d.requiresServer, false);
  assert.equal(d.fulfillmentTargetTemplate, null);
  assert.ok(d.accent.startsWith("hsl("));
});

test("buatGameBaruDefaults: form berzona menyalakan requires_server", () => {
  const d = buatGameBaruDefaults({
    brand: "Some Game",
    kategoriKatalog: "Game",
    fieldsForm: [
      { key: "target_id", name: "Player ID", type: "text" },
      { key: "target_zone", name: "Zone", type: "text" },
    ],
  });
  assert.ok(d);
  assert.equal(d.requiresServer, true);
});

test("buatGameBaruDefaults: nama panjang memakai inisial sebagai short_name", () => {
  const d = buatGameBaruDefaults({
    brand: "Neverness to Everness Global Server",
    kategoriKatalog: "Game",
    fieldsForm: null,
  });
  assert.ok(d);
  assert.equal(d.shortName, makeInitials("Neverness To Everness Global Server"));
});

test("buatGameBaruDefaults: brand kosong menghasilkan null, bukan baris sampah", () => {
  assert.equal(
    buatGameBaruDefaults({ brand: "", kategoriKatalog: "Game", fieldsForm: null }),
    null,
  );
});

test("buatGameBaruDefaults: fallbackId dipakai kalau slug brand kosong", () => {
  const d = buatGameBaruDefaults({
    brand: ";;;",
    kategoriKatalog: "Game",
    fieldsForm: null,
    fallbackId: "mssku123-s1",
  });
  assert.ok(d);
  assert.equal(d.id, "mssku123-s1");
});

test("stableAccent: nama sama menghasilkan warna sama (deterministik)", () => {
  assert.equal(stableAccent("Free Fire"), stableAccent("Free Fire"));
  assert.notEqual(stableAccent("Free Fire"), stableAccent("Mobile Legends"));
});
