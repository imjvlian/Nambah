import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCostUpdate,
  COST_DELTA_HOLD_RATIO,
} from "../src/lib/cost-update-guard.ts";

test("harga sama → unchanged (tidak menyentuh DB)", () => {
  assert.equal(classifyCostUpdate(62415, 62415), "unchanged");
});

test("delta wajar diterapkan otomatis", () => {
  // Kasus nyata 17 Okt: 62.415 → 63.172 (+1.2%) - kelas drift yang justru
  // bikin order gagal dispatch karena tak pernah tersinkron.
  assert.equal(classifyCostUpdate(62415, 63172), "apply");
  assert.equal(classifyCostUpdate(10000, 10999), "apply");
});

test("delta >±10% DITAHAN untuk review manual", () => {
  assert.equal(classifyCostUpdate(62415, 100000), "hold");
  assert.equal(classifyCostUpdate(10000, 5000), "hold");
  assert.equal(classifyCostUpdate(10000, 11001), "hold");
});

test("tepat 10% masih diterapkan (hold hanya untuk yang melebihi)", () => {
  assert.equal(classifyCostUpdate(10000, 11000), "apply");
  assert.equal(COST_DELTA_HOLD_RATIO, 0.1);
});

test("mapping rusak (cost 0) diperbaiki, bukan dianggap lonjakan", () => {
  assert.equal(classifyCostUpdate(0, 62415), "apply");
});

test("nilai tidak sehat ditahan, bukan diterapkan", () => {
  assert.equal(classifyCostUpdate(Number.NaN, 1000), "hold");
  assert.equal(classifyCostUpdate(1000, Number.NaN), "hold");
  assert.equal(classifyCostUpdate(1000, -5), "hold");
});
