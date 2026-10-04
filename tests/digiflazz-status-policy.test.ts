import assert from "node:assert/strict";
import test from "node:test";
import {
  isSupplierTerminalStatus,
  normalizeDigiflazzStatus,
} from "../src/lib/digiflazz-status-policy.ts";

test("normalizes Digiflazz localized statuses", () => {
  assert.equal(normalizeDigiflazzStatus("Sukses"), "success");
  assert.equal(normalizeDigiflazzStatus("Gagal"), "failed");
  assert.equal(normalizeDigiflazzStatus("Pending"), "pending");
  assert.equal(normalizeDigiflazzStatus("other"), "unknown");
});

test("only success and failed are supplier terminal statuses", () => {
  assert.equal(isSupplierTerminalStatus("success"), true);
  assert.equal(isSupplierTerminalStatus("failed"), true);
  assert.equal(isSupplierTerminalStatus("pending"), false);
  assert.equal(isSupplierTerminalStatus("unknown"), false);
});
