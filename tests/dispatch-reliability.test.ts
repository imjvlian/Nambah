import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guard test level-source untuk reliabilitas dispatch (fix 17 Okt 2026).
 *
 * Empat bug yang dikunci di sini berasal dari satu insiden nyata: order
 * NBH-20261017-5F860649E9 (WDP, Melostore) ditolak MAX_PRICE_TOO_LOW,
 * tapi (1) error tidak pernah tercatat di row, (2) filter idempotensi
 * hardcode digiflazz sehingga retry mereset row terus-menerus dan
 * berisiko kirim transaksi dobel di live, (3) sweep status hanya mengenal
 * digiflazz - order melostore hanya bisa selesai via webhook, dan
 * (4) paid_at tersimpan +7 jam.
 */

const fulfillment = readFileSync("src/lib/fulfillment.ts", "utf8");
const reconciliation = readFileSync("src/lib/reconciliation.ts", "utf8");
const orderService = readFileSync("src/lib/order-service.ts", "utf8");
const priceSyncLib = readFileSync("src/lib/supplier-price-sync.ts", "utf8");
const cronRoute = readFileSync(
  "src/app/api/cron/supplier-price-sync/route.ts",
  "utf8",
);
const timers = readFileSync("deploy/systemd/install-timers.sh", "utf8");
const telegramAlerts = readFileSync("src/lib/telegram-alerts.ts", "utf8");

test("idempotensi dispatch: filter getSupplierTransaction tidak boleh hardcode digiflazz", () => {
  assert.ok(
    fulfillment.includes("getSupplierTransaction(requestRef, client.id)"),
    "jalur supplier generik harus mencari row per supplier",
  );
  assert.ok(
    fulfillment.includes("resolution=ignore-duplicates"),
    "upsert retry tidak boleh menimpa baris yang sudah ada",
  );
});

test("kegagalan dispatch tercatat + error terminal menggagalkan order", () => {
  assert.ok(fulfillment.includes("classifySupplierDispatchError"));
  assert.ok(fulfillment.includes("MAX_PRICE_TOO_LOW"));
  assert.ok(fulfillment.includes("PROVIDER_PRICE_CHANGED"));
  assert.ok(fulfillment.includes("dispatch_error:"));
  assert.ok(
    fulfillment.includes('finalizeOrder(order.id, "failed")'),
    "error terminal harus menggagalkan order supaya refund jalan",
  );
  assert.ok(
    fulfillment.includes("notifySupplierDispatchBalanceDepleted"),
    "saldo habis saat dispatch harus mengirim alert Telegram",
  );
});

test("polling status melostore aktif di sweep reconcile", () => {
  assert.ok(
    reconciliation.includes('supplier_id: "eq.melostore"'),
    "sweep harus mengambil baris pending melostore",
  );
  assert.ok(reconciliation.includes("MelostoreStatusService.apply"));
  assert.ok(reconciliation.includes("fetchTransactionStatus"));
});

test("paid_at diparse lewat helper timezone - pola lama hilang", () => {
  assert.ok(orderService.includes("gatewayTimeToUtcIso(payload.settlement_time)"));
  assert.ok(orderService.includes("gatewayTimeToUtcIso(input.paidTime)"));
  assert.ok(
    !orderService.includes("paid_at = payload.settlement_time ?? now"),
    "penyimpanan mentah settlement_time dilarang kembali",
  );
  assert.ok(
    !orderService.includes("paid_at: input.paidTime ?? now"),
    "penyimpanan mentah paidTime dilarang kembali",
  );
});

test("migrasi backfill paid_at +7 jam ada dan berjarak aman", () => {
  const migration = readFileSync(
    "supabase/migrations/20261017_055_backfill_paid_at_timezone.sql",
    "utf8",
  );
  assert.ok(migration.includes("interval '7 hours'"));
  assert.ok(migration.includes("merchant_id is null"));
  assert.ok(migration.includes("interval '31 minutes'"));
});

test("auto-sync harga supplier: cron, jadwal, guard, dan notifikasi", () => {
  assert.ok(cronRoute.includes("authorizeCronRequest("));
  assert.ok(timers.includes("supplier-price-sync"));
  assert.ok(priceSyncLib.includes("classifyCostUpdate"));
  assert.ok(priceSyncLib.includes("enqueueTelegramMessage"));
  assert.ok(priceSyncLib.includes("last_synced_at"));
  // Harga jual sengaja TIDAK disentuh jalur otomatis.
  assert.ok(!priceSyncLib.includes("selling_price"));
});

test("alert saldo dispatch tersedia di telegram-alerts", () => {
  assert.ok(telegramAlerts.includes("notifySupplierDispatchBalanceDepleted"));
});
