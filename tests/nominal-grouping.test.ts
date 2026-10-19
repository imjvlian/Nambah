import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guard test level-source untuk pengelompokan seksi nominal dan urutan
 * ikon (perbaikan 20 Okt 2026, kasus MLBB):
 * - WDP/2x/3x dan Monthly/Weekly Elite Bundle harus masuk seksi
 *   "Paket Mingguan / Bulanan" (dulu: WDP masuk "Item Spesial",
 *   Monthly Elite Bundle jatuh ke "Top Up").
 * - Seksi mingguan/bulanan diurut per jenis: pass (WDP 1x -> 2x -> 3x)
 *   dulu, lalu elite (mingguan -> bulanan).
 * - FTU adalah item currency: glyph diamond, bukan visual kind
 *   tersendiri (keputusan owner 20 Okt 2026).
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

test("FTU memakai glyph diamond (item currency) - keputusan owner 20 Okt", () => {
  const start = ui.indexOf("function getPackageVisualKind");
  const end = ui.indexOf('return "default";', start);
  assert.ok(start > 0 && end > start, "fungsi visual kind harus ada");
  const fn = ui.slice(start, end);

  assert.ok(
    !fn.includes("first-top-up"),
    "FTU bukan visual kind tersendiri - glyph diamond sudah tepat untuk item currency",
  );
  assert.ok(!ui.includes('return "1ST";'));
});

test("seksi mingguan/bulanan diurut per jenis: pass dulu, lalu elite", () => {
  assert.ok(ui.includes("urutkanSeksiMingguanBulanan"));
  // Diterapkan hanya untuk seksi mingguan/bulanan.
  assert.ok(ui.includes('section.id === "weekly-monthly"'));
  // Rank jenis: pass/card (dengan pengali 2x/3x) -> elite/epic
  // (mingguan -> bulanan) -> sisanya.
  assert.ok(ui.includes("/(pass|card)/"));
  assert.ok(ui.includes("/3x/"));
  assert.ok(ui.includes("/2x/"));
  assert.ok(ui.includes("elite|epic"));
  assert.ok(ui.includes("monthly|bulanan"));
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
