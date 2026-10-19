import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guard test level-source untuk idempotensi checkout (P1.5, 19 Okt 2026).
 *
 * Tiga jendela order ganda yang dikunci di sini:
 * 1. klik ganda satu frame (guard state React terlambat satu render);
 * 2. retry jaringan;
 * 3. respons hilang di jalan ketika order berhasil dibuat - coba ulang
 *    tidak boleh menghasilkan order kedua yang sama-sama menunggu
 *    dibayar (dua sesi pembayaran aktif = bisa dua-duanya dibayar).
 */

const route = readFileSync("src/app/api/orders/route.ts", "utf8");
const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");

test("migrasi 057: kolom checkout_key + unique index", () => {
  const migration = readFileSync(
    "supabase/migrations/20261019_057_checkout_idempotency.sql",
    "utf8",
  );
  assert.ok(migration.includes("checkout_key"));
  assert.ok(
    migration.includes("orders_checkout_key_uidx"),
    "unique index wajib - penghakim terakhir untuk race dua POST bersamaan",
  );
});

test("pre-check replay sebelum gerbang verifikasi - tidak membakar kuota cek", () => {
  const preCheck = route.indexOf("checkout_key: `eq.${idempotencyKey}`");
  const gate = route.indexOf("verifyOrderAccount({");
  const supplier = route.indexOf("pilihSupplierUntukProduk(");

  assert.ok(preCheck > -1, "pre-check idempotensi harus ada");
  assert.ok(gate > -1);
  assert.ok(
    preCheck < gate,
    "replay harus diputuskan sebelum gerbang verifikasi (jatah cek supplier tidak boleh terbakar untuk replay)",
  );
  assert.ok(
    preCheck < supplier,
    "replay harus diputuskan sebelum pemilihan supplier",
  );
});

test("insert membawa checkout_key + backstop race di catch", () => {
  assert.ok(route.includes("checkout_key: idempotencyKey || null,"));
  assert.ok(route.includes("REPLAYABLE_ORDER_STATUSES"));
  // Hanya order hidup yang boleh di-replay - order mati melepas kuncinya.
  assert.ok(route.includes('"pending_payment"'));
  assert.ok(route.includes('"pending_merchant"'));
  assert.ok(
    route.indexOf("REPLAYABLE_ORDER_STATUSES.has(winner.status)") > -1,
    "kekalahan insert bersamaan harus diarahkan ke order pemenang",
  );
});

test("replay: bentuk respons identik sukses biasa + token akses baru", () => {
  const start = route.indexOf("async function replayOrderResponse");
  assert.ok(start > -1, "helper replay harus ada");
  const fn = route.slice(start, start + 1800);
  assert.ok(fn.includes("access_token_hash: access.tokenHash"));
  assert.ok(
    fn.includes("{ order, accessToken: access.token }"),
    "bentuk respons replay harus identik dengan jalur sukses",
  );
  assert.ok(fn.includes("createOrderAccessCookie"));
});

test("klien: kunci per isi form + guard klik-ganda sinkron", () => {
  assert.ok(ui.includes("!pendingCheckout || submittingRef.current"));
  assert.ok(ui.includes("submittingRef.current = true;"));
  assert.ok(ui.includes("crypto.randomUUID()"));
  assert.ok(ui.includes("idempotencyKey: checkoutKeyRef.current.key"));
  // Rotasi saat isi form berubah - coba ulang tidak pernah diarahkan
  // ke order dengan isi lama.
  assert.ok(ui.includes("checkoutFingerprint"));
  // Dibuang saat sukses - pembelian berikutnya order baru yang sah.
  assert.ok(ui.includes("checkoutKeyRef.current = null;"));
});
