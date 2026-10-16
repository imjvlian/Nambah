import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const AUDITED_ROUTES = [
  "src/app/api/admin/catalog/markup/route.ts",
  "src/app/api/admin/catalog/cleanup/route.ts",
  "src/app/api/admin/digiflazz/sync-prices/route.ts",
  "src/app/api/admin/digiflazz/catalog/publish/route.ts",
  "src/app/api/admin/supplier-balance/route.ts",
  "src/app/api/admin/telegram/test/route.ts",
  "src/app/api/admin/telegram/dispatch/route.ts",
  "src/app/api/admin/telegram/daily-digest/route.ts",
];

test("mutasi admin berisiko tinggi wajib menghasilkan audit log", () => {
  const missing = AUDITED_ROUTES.filter(
    (path) => !readFileSync(path, "utf8").includes("auditAdminAction("),
  );

  assert.deepEqual(
    missing,
    [],
    "Route admin tanpa audit log:\n" + missing.join("\n"),
  );
});

test("checkout wajib mengunci saldo supplier sebelum order dibayar", () => {
  const content = readFileSync("src/app/api/orders/route.ts", "utf8");
  assert.ok(content.includes("reserveSupplierBalance("));
});
