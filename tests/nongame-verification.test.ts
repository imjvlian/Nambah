import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getGameAccountSchema } from "../src/lib/game-account.ts";
import {
  getMelostoreGameCode,
  melostoreCodeRequiresZone,
} from "../src/lib/melostore-game-codes.ts";

/**
 * P1.6 — Verifikasi target non-game (21 Okt 2026).
 *
 * E-wallet (dana/gopay/ovo/shopeepay/linkaja/isaku): nama pemilik akun
 * dicek via Melostore check-nickname — jalur yang sama dengan game
 * universal, cukup checker + pemetaan.
 *
 * PLN: nama pelanggan dicek via inquiry Digiflazz (command "pln",
 * bebas biaya, tanpa transaksi) — jalur baru di engine.
 *
 * UI: banner menampilkan "a/n NAMA" (bukan "Akun kamu") untuk produk
 * non-game, dan pesan penolakan tidak menyebut "User ID game/Zone"
 * untuk e-wallet/PLN.
 */

const game = (id: string, name: string, shortName?: string) =>
  getGameAccountSchema({ id, name, shortName: shortName ?? name, requiresServer: false });

test("schema e-wallet: checker universal + input nomor HP", () => {
  for (const [id, name] of [
    ["dana", "DANA"],
    ["gopay", "GoPay"],
    ["ovo", "OVO"],
    ["shopeepay", "ShopeePay"],
    ["linkaja", "LinkAja"],
    ["isaku", "i.saku"],
  ] as const) {
    const schema = game(id, name);
    assert.equal(schema.kind, "phone", `${id} harus kind phone`);
    assert.equal(schema.checker, "universal", `${id} harus punya checker`);
  }
});

test("schema pulsa: TETAP tanpa checker (regresi)", () => {
  // Pulsa tidak punya cek nama di provider mana pun — jangan sampai
  // terbawa e-wallet dan memicu alarm gap untuk semua operator.
  for (const [id, name] of [
    ["telkomsel", "Telkomsel"],
    ["indosat", "Indosat"],
    ["xl", "XL"],
    ["axis", "AXIS"],
    ["smartfren", "Smartfren"],
    ["byu", "by.U"],
  ] as const) {
    const schema = game(id, name);
    assert.equal(schema.checker, null, `${id} tidak boleh punya checker`);
  }
});

test("schema PLN: checker pln; tagihan non-PLN tetap null", () => {
  const pln = game("pln-token", "PLN Token");
  assert.equal(pln.kind, "numeric-bill");
  assert.equal(pln.checker, "pln", "PLN harus lewat inquiry Digiflazz");

  const pertamina = game("pertamina-gas", "Pertamina Gas");
  assert.equal(pertamina.kind, "numeric-bill");
  assert.equal(pertamina.checker, null, "inquiry hanya untuk PLN");

  const kvision = game("k-vision", "K Vision");
  assert.equal(kvision.checker, null);
});

test("pemetaan e-wallet: game code Melostore + tanpa zone", () => {
  assert.equal(getMelostoreGameCode("dana"), "dana");
  assert.equal(getMelostoreGameCode("go-pay"), "gopay");
  assert.equal(getMelostoreGameCode("gopay"), "gopay");
  assert.equal(getMelostoreGameCode("ovo"), "ovo");
  assert.equal(getMelostoreGameCode("shopee-pay"), "shopeepay");
  assert.equal(getMelostoreGameCode("shopeepay"), "shopeepay");
  assert.equal(getMelostoreGameCode("linkaja"), "linkaja");
  assert.equal(getMelostoreGameCode("isaku"), "isaku");
  assert.equal(getMelostoreGameCode("i-saku"), "isaku");

  // Semua e-wallet zone_required: false — melostoreCodeRequiresZone
  // tidak boleh menahannya.
  for (const code of ["dana", "gopay", "ovo", "shopeepay", "linkaja", "isaku"]) {
    assert.equal(
      melostoreCodeRequiresZone(code),
      false,
      `${code} tidak boleh menuntut zone`,
    );
  }
});

test("digiflazz client: fungsi inquiry PLN dengan command pln", () => {
  const client = readFileSync("src/lib/digiflazz/client.ts", "utf8");
  assert.ok(client.includes("export async function inquireDigiflazzPln"));
  assert.ok(client.includes('commands: "pln"'));
  assert.ok(client.includes("customer_name"), "nama pelanggan harus diparse");
});

test("engine: cabang PLN sebelum jalur Melostore; e-wallet lewat universal", () => {
  const engine = readFileSync("src/lib/account-verification.ts", "utf8");
  assert.ok(
    engine.includes('schema.checker === "pln"'),
    "cabang inquiry PLN harus ada",
  );
  assert.ok(engine.includes("inquireDigiflazzPln"));
  // Klasifikasi: galat auth/IP = unavailable (bukan invalid).
  assert.ok(
    engine.includes(/auth|unauthorized|api key|whitelist|forbidden/i.source
      .replace(/\\./g, "")),
    "engine harus membedakan galat konfigurasi dari salah nomor",
  );
});

test("check route: e-wallet via Melostore + PLN via inquiry sebelum localOnly", () => {
  const route = readFileSync("src/app/api/game-account/check/route.ts", "utf8");
  assert.ok(route.includes("ewalletCode"));
  assert.ok(route.includes("checkMelostoreNickname"));
  assert.ok(route.includes("inquireDigiflazzPln"));
  assert.ok(
    route.indexOf("inquireDigiflazzPln") < route.indexOf("localOnly: true"),
    "inquiry harus dicoba sebelum menyerah ke localOnly",
  );
});

test("orders route: pesan penolakan per jenis produk", () => {
  const route = readFileSync("src/app/api/orders/route.ts", "utf8");
  assert.ok(
    route.includes("Nomor e-wallet Anda tidak ditemukan"),
    "pesan invalid e-wallet tidak boleh menyebut User ID game",
  );
  assert.ok(
    route.includes("Nomor pelanggan Anda tidak ditemukan"),
    "pesan invalid PLN harus menyebut nomor pelanggan",
  );
});

test("UI: banner a/n NAMA untuk produk non-game", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  assert.ok(
    ui.includes("accountSchema.kind === \"phone\""),
    "banner harus bercabang per jenis skema",
  );
  assert.ok(ui.includes("a/n"));
});
