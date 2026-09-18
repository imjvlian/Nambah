import assert from "node:assert/strict";
import test from "node:test";
import {
  isTestLabScenario,
  isTestLabScope,
  normalizeTestLabRemainingUses,
} from "../src/lib/test-lab-policy.ts";

test("accepts only supported supplier scenarios", () => {
  assert.equal(isTestLabScenario("success"), true);
  assert.equal(isTestLabScenario("pending-failed"), true);
  assert.equal(isTestLabScenario("digiflazz-live"), false);
});

test("accepts only supported scopes", () => {
  assert.equal(isTestLabScope("next-order"), true);
  assert.equal(isTestLabScope("until-changed"), true);
  assert.equal(isTestLabScope("forever-live"), false);
});

test("normalizes bounded next-n usage", () => {
  assert.equal(normalizeTestLabRemainingUses("next-order", 99), 1);
  assert.equal(normalizeTestLabRemainingUses("until-changed", 99), null);
  assert.equal(normalizeTestLabRemainingUses("next-n", 5), 5);
  assert.throws(() => normalizeTestLabRemainingUses("next-n", 0));
  assert.throws(() => normalizeTestLabRemainingUses("next-n", 101));
});
