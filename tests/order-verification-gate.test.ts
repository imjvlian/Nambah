import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_VOLSEVER_ROUTES } from "../src/lib/volsever/games.ts";

/**
 * Guard test level-source untuk gerbang verifikasi akun (P0).
 *
 * Pola yang sama dengan refund-flow.test.ts: bagian yang tidak bisa diuji
 * murni (route handler, migrasi) dikunci lewat isi file — cukup untuk
 * mendeteksi regresi struktural, sementara perilaku murninya diuji di
 * account-verification-policy.test.ts dan melostore-nickname.test.ts.
 */

test("migrasi 054 mencatat jejak audit verifikasi di orders", () => {
  const migration = readFileSync(
    "supabase/migrations/20261017_054_account_verification_gate.sql",
    "utf8",
  );

  for (const column of [
    "account_verification_status",
    "account_check_provider",
    "account_nickname",
    "account_region",
    "account_verified_at",
  ]) {
    assert.ok(
      migration.includes(`add column if not exists ${column}`),
      `kolom ${column} harus ada di migrasi`,
    );
  }

  // Semua status policy harus muat di constraint.
  for (const status of [
    "verified",
    "invalid",
    "unavailable",
    "not_required",
    "not_configured",
    "limit_blocked",
    "skipped",
  ]) {
    assert.ok(migration.includes(`'${status}'`), `status ${status}`);
  }

  // Cache provider meluas ke melostore.
  assert.ok(migration.includes("account_check_cache_provider_check"));
  assert.match(migration, /provider in \('volsever', 'mimih', 'melostore'\)/);
});

test("gerbang terpasang di checkout: setelah supplier, sebelum insert dan reservasi", () => {
  const source = readFileSync("src/app/api/orders/route.ts", "utf8");

  const supplierSel = source.indexOf("pilihSupplierUntukProduk(");
  const gateCall = source.indexOf("verifyOrderAccount({");
  const gateDecision = source.indexOf(
    "decideAccountGate(\n    accountVerification,\n    verificationMode,\n  )",
  );
  const insert = source.indexOf('supabaseInsert("orders"');
  const reserve = source.indexOf("reserveSupplierBalance(");

  assert.ok(gateCall > 0, "checkout harus memanggil verifyOrderAccount");
  assert.ok(
    supplierSel > 0 && gateCall > supplierSel,
    "gate butuh supplier SKU untuk kontrol weekly pass MLBB",
  );
  assert.ok(insert > gateCall, "gate harus sebelum insert order");
  assert.ok(reserve > gateCall, "gate harus sebelum reservasi saldo supplier");
  assert.ok(gateDecision > 0, "keputusan gate harus lewat decideAccountGate");

  // Jejak audit ikut tertulis saat insert.
  assert.ok(
    source.includes(
      "account_verification_status: accountVerification.status",
    ),
  );
  assert.ok(
    source.includes("account_verified_at: accountVerification.checkedAt"),
  );
});

test("kill-switch mode admin terjaga dan ter-audit", () => {
  const route = readFileSync(
    "src/app/api/admin/account-verification/route.ts",
    "utf8",
  );

  assert.ok(route.includes("authorizeAdminRequest(request)"));
  assert.ok(route.includes("auditAdminAction(request"));
  assert.ok(route.includes("isAccountVerificationMode"));
  assert.ok(route.includes("setAccountVerificationMode"));
});

test("readiness menampilkan status gerbang + gap pemetaan", () => {
  const readiness = readFileSync(
    "src/app/api/admin/readiness/route.ts",
    "utf8",
  );

  assert.ok(readiness.includes('"account-verification-gate"'));
  assert.ok(readiness.includes("isMelostoreConfigured()"));
  assert.ok(readiness.includes("verificationGaps"));
});

test("settings gate fail-open ke off — bukan throw, bukan enforce", () => {
  const settings = readFileSync(
    "src/lib/account-verification-settings.ts",
    "utf8",
  );

  assert.ok(
    settings.includes('const DEFAULT_MODE: AccountVerificationMode = "off"'),
    "default harus off",
  );
  assert.ok(settings.includes("catch"), "error DB harus ditelan");
  assert.ok(settings.includes("return DEFAULT_MODE;"));
});

test("bug key Volsever league-of-legends sudah diperbaiki", () => {
  // Sebelum P0: key "league-of-legends" tidak pernah cocok dengan game ID
  // mana pun (ID asli league-of-legends-pc), jadi route sehat itu mati.
  assert.equal(
    DEFAULT_VOLSEVER_ROUTES["league-of-legends-pc"],
    "league-of-legends",
  );
  assert.equal(DEFAULT_VOLSEVER_ROUTES["league-of-legends"], undefined);
});

test("engine tidak pernah memblokir MLBB lewat cache", () => {
  // Kontrol weekly pass MLBB hanya hidup kalau purchase-limit selalu
  // dipanggil. Kalau ada readCachedAccountCheck sebelum cabang MLBB,
  // order ulang bisa melewati limit.
  const engine = readFileSync("src/lib/account-verification.ts", "utf8");
  const mlbbBranch = engine.indexOf('input.gameId === MLBB_GAME_ID');
  const cacheRead = engine.indexOf("readCachedAccountCheck(");

  assert.ok(mlbbBranch > 0);
  assert.ok(cacheRead > mlbbBranch, "cache read harus setelah cabang MLBB");
});

test("region dari supplier mengalir ke hasil verifikasi + cache (tidak dibuang)", () => {
  // Docs Melostore: check-nickname mengirim region (mis. "ID") untuk game
  // yang memilikinya. Data ini sudah dibayar bersama ceknya - membuangnya
  // berarti banner cek akun dan kolom audit account_region kosong melulu.
  const engine = readFileSync("src/lib/account-verification.ts", "utf8");
  assert.ok(
    engine.includes("region: result.region"),
    "hasil cek supplier harus membawa region ke hasil verifikasi",
  );
  const route = readFileSync(
    "src/app/api/game-account/check/route.ts",
    "utf8",
  );
  assert.ok(
    route.includes("region: limit.region"),
    "banner cek akun harus menerima region dari purchase-limit",
  );
});
