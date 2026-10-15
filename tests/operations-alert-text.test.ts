import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOperationsAlertMessage,
  type OperationsAlertIncident,
  type OperationsAlertSupplierBalance,
} from "../src/lib/operations-alert-text.ts";

const incidents: OperationsAlertIncident[] = [
  {
    severity: "warning",
    title: "Order masih belum selesai",
    detail:
      "3 order paid/processing sudah lebih dari 5 menit. Contoh: #NBH-1, #NBH-2. Total nilai: Rp 120.000.",
  },
  {
    severity: "critical",
    title: "Saldo Melostore kritis",
    detail: "Saldo Rp 50.000 — tersedia Rp 30.000, reserved Rp 20.000.",
  },
];

const balances: OperationsAlertSupplierBalance[] = [
  {
    supplierLabel: "Digiflazz",
    status: "healthy",
    balance: 350_000,
    reservedBalance: 50_000,
  },
  {
    supplierLabel: "Melostore",
    status: "critical",
    balance: 50_000,
    reservedBalance: 20_000,
  },
];

test("pesan operasi memuat judul brand, incident, dan saldo supplier", () => {
  const text = buildOperationsAlertMessage({
    brandName: "Lacte Game Store",
    incidents,
    supplierBalances: balances,
  });

  assert.match(text, /Lacte Game Store Ops — 2 hal perlu dicek/);
  assert.match(text, /Order masih belum selesai/);
  assert.match(text, /Saldo Melostore kritis/);
  assert.match(text, /Digiflazz: Rp\s?350\.000 — AMAN/);
  assert.match(text, /Melostore: Rp\s?50\.000 — KRITIS/);
});

test("incident kritis muncul lebih dulu daripada warning", () => {
  const text = buildOperationsAlertMessage({
    brandName: "Lacte Game Store",
    incidents,
    supplierBalances: [],
  });

  const criticalIndex = text.indexOf("Saldo Melostore kritis");
  const warningIndex = text.indexOf("Order masih belum selesai");

  assert.ok(criticalIndex > -1);
  assert.ok(warningIndex > -1);
  assert.ok(criticalIndex < warningIndex);
});

test("pesan di-potong setelah 5 incident pertama", () => {
  const manyIncidents: OperationsAlertIncident[] = Array.from(
    { length: 7 },
    (_, index) => ({
      severity: "warning" as const,
      title: `Incident ${index + 1}`,
      detail: `Detail incident ${index + 1}`,
    }),
  );

  const text = buildOperationsAlertMessage({
    brandName: "Lacte Game Store",
    incidents: manyIncidents,
    supplierBalances: [],
  });

  assert.match(text, /Incident 1/);
  assert.match(text, /Incident 5/);
  assert.doesNotMatch(text, /Incident 6\n/);
  assert.match(text, /\+2 lainnya/);
});
