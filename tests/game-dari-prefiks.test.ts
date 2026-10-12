import test from "node:test";
import assert from "node:assert/strict";

import { gameDariPrefiksSku } from "../src/lib/suppliers/match.ts";

/**
 * Peta balik prefiks SKU Melostore ke gameId Nambah.
 *
 * Digunakan oleh:
 * - merge-internal-sku: turunkan SKU internal dari sisi Melostore
 * - Browser katalog Melostore: kelompokkan per game di server
 *
 * Aturan:
 * - Prefiks unik (mlid, hok, pubgm, val, dll) → confident: true
 * - Prefiks ambigu (ff, ffid, ffg) → confident: false (FF vs FFMAX)
 * - Prefiks tidak dikenal → gameId: "", confident: false
 */

test("prefiks ML Indonesia → mobile-legends confident", () => {
  const r = gameDariPrefiksSku("mlid56d-s1");
  assert.equal(r.gameId, "mobile-legends");
  assert.equal(r.confident, true);
});

test("prefiks ML Malaysia → mobile-legends confident", () => {
  const r = gameDariPrefiksSku("mlmy56d-s1");
  assert.equal(r.gameId, "mobile-legends");
  assert.equal(r.confident, true);
});

test("prefiks ML Global → mobile-legends confident", () => {
  const r = gameDariPrefiksSku("mlgl56d-s1");
  assert.equal(r.gameId, "mobile-legends");
  assert.equal(r.confident, true);
});

test("prefiks HOK → honor-of-kings confident", () => {
  const r = gameDariPrefiksSku("hok100ep-s1");
  assert.equal(r.gameId, "honor-of-kings");
  assert.equal(r.confident, true);
});

test("prefiks PUBG Mobile Global → pubg-mobile confident (prefiks panjang lebih dulu)", () => {
  const r = gameDariPrefiksSku("pubgmgl-uc-s1");
  assert.equal(r.gameId, "pubg-mobile");
  assert.equal(r.confident, true);
});

test("prefiks PUBG Mobile → pubg-mobile confident", () => {
  const r = gameDariPrefiksSku("pubgm100-s1");
  assert.equal(r.gameId, "pubg-mobile");
  assert.equal(r.confident, true);
});

test("prefiks Valorant → valorant confident", () => {
  const r = gameDariPrefiksSku("val500-s1");
  assert.equal(r.gameId, "valorant");
  assert.equal(r.confident, true);
});

test("prefiks FF ambigu → free-fire NOT confident", () => {
  const r = gameDariPrefiksSku("ff50d-s1");
  assert.equal(r.gameId, "free-fire");
  assert.equal(r.confident, false);
});

test("prefiks FFID ambigu → free-fire NOT confident", () => {
  const r = gameDariPrefiksSku("ffid50d-s7");
  assert.equal(r.gameId, "free-fire");
  assert.equal(r.confident, false);
});

test("prefiks FGG ambigu → free-fire NOT confident", () => {
  const r = gameDariPrefiksSku("ffg100-s1");
  assert.equal(r.gameId, "free-fire");
  assert.equal(r.confident, false);
});

test("prefiks Genshin → genshin-impact confident", () => {
  const r = gameDariPrefiksSku("genshin100-s1");
  assert.equal(r.gameId, "genshin-impact");
  assert.equal(r.confident, true);
});

test("prefiks YS → genshin-impact confident", () => {
  const r = gameDariPrefiksSku("ys100-s1");
  assert.equal(r.gameId, "genshin-impact");
  assert.equal(r.confident, true);
});

test("prefiks GI → genshin-impact confident", () => {
  const r = gameDariPrefiksSku("gi100-s1");
  assert.equal(r.gameId, "genshin-impact");
  assert.equal(r.confident, true);
});

test("prefiks tidak dikenal → gameId kosong", () => {
  const r = gameDariPrefiksSku("xyz123");
  assert.equal(r.gameId, "");
  assert.equal(r.confident, false);
});

test("string kosong → gameId kosong", () => {
  const r = gameDariPrefiksSku("");
  assert.equal(r.gameId, "");
  assert.equal(r.confident, false);
});

test("huruf besar di SKU tidak mempengaruhi", () => {
  const r = gameDariPrefiksSku("MLID56D-S1");
  assert.equal(r.gameId, "mobile-legends");
  assert.equal(r.confident, true);
});

test("spasi di SKU tidak mempengaruhi", () => {
  const r = gameDariPrefiksSku(" mlid56d-s1 ");
  assert.equal(r.gameId, "mobile-legends");
  assert.equal(r.confident, true);
});