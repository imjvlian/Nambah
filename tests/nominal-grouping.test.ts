import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guard test level-source untuk pengelompokan seksi nominal dan ikon
 * visual kind (perbaikan 20 Okt 2026, kasus MLBB):
 * - WDP/2x/3x dan Monthly/Weekly Elite Bundle harus masuk seksi
 *   "Paket Mingguan / Bulanan" (dulu: WDP masuk "Item Spesial",
 *   Monthly Elite Bundle jatuh ke "Top Up").
 * - First Top Up MLBB harus punya visual kind sendiri (dulu: glyph ◆
 *   karena labelnya menyebut "Diamonds").
 * - Twilight Pass tetap di "Item Spesial" (sekali per akun, bukan
 *   paket berulang).
 */

const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");

test("seksi mingguan/bulanan menampung WDP dan Elite Bundle", () => {
  const start = ui.indexOf("function getNominalSectionId");
  const end = ui.indexOf('return "top-up";', start);
  assert.ok(start > 0 && end > start, "fungsi seksi harus ada");
  const fn = ui.slice(start, end);

  // Urutan cek: FTU dulu, lalu mingguan/bulanan, lalu spesial.
  assert.ok(
    fn.indexOf("first-top-up") < fn.indexOf("weekly-monthly"),
    "FTU harus dicek sebelum mingguan/bulanan",
  );
  assert.ok(
    fn.indexOf("weekly-monthly") < fn.indexOf("special"),
    "mingguan/bulanan harus dicek sebelum spesial (WDP memuat 'pass')",
  );

  // WDP (varian 1x/2x/3x) dan Elite Bundle/Pack mingguan & bulanan.
  assert.ok(fn.includes("weekly diamond pass"), "WDP masuk seksi mingguan");
  assert.ok(fn.includes("weekly elite"), "Weekly Elite masuk seksi mingguan");
  assert.ok(fn.includes("monthly elite"), "Monthly Elite masuk seksi mingguan");
  assert.ok(fn.includes("weekly bundle"));
  assert.ok(fn.includes("monthly bundle"));
});

test("visual kind first-top-up dicek sebelum diamond", () => {
  const start = ui.indexOf("function getPackageVisualKind");
  const end = ui.indexOf('return "default";', start);
  assert.ok(start > 0 && end > start, "fungsi visual kind harus ada");
  const fn = ui.slice(start, end);

  const ftu = fn.indexOf('return "first-top-up";');
  const diamond = fn.indexOf('return "diamond";');
  assert.ok(ftu > -1, "cabang first-top-up harus ada");
  assert.ok(
    ftu < diamond,
    "first top up harus dicek sebelum diamond - label FTU selalu menyebut nominal diamonds",
  );
  assert.ok(fn.includes("first top up"));
  assert.ok(fn.includes("first recharge"));
});

test("glyph 1ST + CSS kartu v4 untuk first-top-up", () => {
  assert.ok(ui.includes('if (kind === "first-top-up") return "1ST";'));
  const css = readFileSync("src/app/product-grouped-nominals.css", "utf8");
  assert.ok(css.includes(".package-card-v4 .package-item-visual.first-top-up"));
});

test("Twilight Pass tetap di seksi Item Spesial", () => {
  const start = ui.indexOf("function getNominalSectionId");
  const end = ui.indexOf('return "top-up";', start);
  const fn = ui.slice(start, end);
  assert.ok(
    fn.includes("twilight pass"),
    "twilight tetap dikenali sebagai item spesial (sekali per akun, bukan berulang)",
  );
});
