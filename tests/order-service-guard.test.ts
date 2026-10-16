import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("status order Midtrans, DOKU, dan Paylabs memakai transisi CAS", () => {
  const content = readFileSync("src/lib/order-service.ts", "utf8");
  const matches = content.match(/transitionOrderStatus\(/g) ?? [];

  assert.ok(
    matches.length >= 3,
    `expected at least 3 CAS transitions, found ${matches.length}`,
  );
});

test("checkout mengunci saldo supplier sebelum order dibayar", () => {
  const content = readFileSync("src/app/api/orders/route.ts", "utf8");

  assert.ok(content.includes("reserveSupplierBalance("));
  assert.ok(content.includes("supplier_balance_insufficient"));
  assert.ok(content.includes("supplier_balance_reservation_failed"));
});
