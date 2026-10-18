import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isLimitedPackageCandidate,
  isOncePerAccountLabel,
  parsePublicPurchaseLimit,
  summarizePurchaseLimit,
} from "../src/lib/purchase-limit-ux.ts";

/**
 * 0.9a — UX item limited (WDP / Double Diamonds MLBB).
 *
 * Bagian murni diuji langsung; bagian integrasi dijaga level-source:
 * - endpoint limit WAJIB cache-only (aturan RPM owner)
 * - route cek UI MLBB memakai purchase-limit Melostore
 * - engine menyimpan payload limit ke cache
 * - audit order mencatat alasan limit
 * - inspector admin menampilkan kolom verifikasi
 */

const xeesoxeeLike = {
  weeklyPass: [
    { packageCode: "weekly-pass", limitReached: true },
    { packageCode: "weekly-pass-new", limitReached: false },
  ],
  doubleDiamonds: [{ packageCode: "double-diamonds-150", limitReached: false }],
  doubleDiamondsEligible: false,
};

test("summarizePurchaseLimit: WDP tercapai + DD sudah diklaim = 2 baris advisory", () => {
  const lines = summarizePurchaseLimit(xeesoxeeLike);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /weekly diamond pass/i);
  assert.match(lines[1]!, /double diamonds/i);
});

test("summarizePurchaseLimit: akun bersih tidak menghasilkan baris", () => {
  assert.deepEqual(
    summarizePurchaseLimit({
      weeklyPass: [],
      doubleDiamonds: [],
      doubleDiamondsEligible: true,
    }),
    [],
  );
  assert.deepEqual(summarizePurchaseLimit(null), []);
  assert.deepEqual(summarizePurchaseLimit(undefined), []);
});

test("parsePublicPurchaseLimit: payload valid diparse, sampah ditolak null", () => {
  const parsed = parsePublicPurchaseLimit(xeesoxeeLike);
  assert.equal(parsed?.weeklyPass.length, 2);
  assert.equal(parsed?.doubleDiamondsEligible, false);
  assert.equal(parsePublicPurchaseLimit({ hello: 1 }), null);
  assert.equal(parsePublicPurchaseLimit("junk"), null);
  assert.equal(parsePublicPurchaseLimit(null), null);
});

test("isLimitedPackageCandidate: pemicu = sekali-per-akun (semua game) + WDP/DD MLBB", () => {
  assert.equal(
    isLimitedPackageCandidate("mobile-legends", "Weekly Diamond Pass 2x"),
    true,
  );
  assert.equal(
    isLimitedPackageCandidate("mobile-legends", "Double Diamonds 150"),
    true,
  );
  assert.equal(
    isLimitedPackageCandidate("magic-chess", "First Recharge 300 Diamonds"),
    true,
  );
  assert.equal(
    isLimitedPackageCandidate("mobile-legends", "First Top Up 50+Bonus Diamonds"),
    true,
  );
  assert.equal(isLimitedPackageCandidate("mobile-legends", "86 Diamonds"), false);
  assert.equal(isLimitedPackageCandidate("free-fire", "Weekly Membership"), false);
});

test("endpoint limit cache-only: tidak pernah memanggil Melostore", () => {
  const route = readFileSync("src/app/api/game-account/limit/route.ts", "utf8");
  assert.ok(route.includes("readCachedAccountCheck"));
  assert.ok(route.includes("decideMlbbPurchaseLimit"));
  assert.ok(route.includes("rateLimitResponse"));
  assert.ok(
    !route.includes("checkMelostorePurchaseLimit"),
    "endpoint wajib cache-only — popup tidak boleh membakar jatah cek (aturan RPM)",
  );
});

test("route cek UI: MLBB memakai purchase-limit Melostore + datanya ikut response", () => {
  const route = readFileSync("src/app/api/game-account/check/route.ts", "utf8");
  assert.ok(route.includes("checkMelostorePurchaseLimit"));
  assert.ok(route.includes("purchaseLimit"));
});

test("engine menyimpan payload purchase-limit ke cache — termasuk saat limit tercapai", () => {
  const engine = readFileSync("src/lib/account-verification.ts", "utf8");
  assert.ok(engine.includes("purchaseLimit"));
});

test("audit order mencatat alasan limit (kolom migrasi 056)", () => {
  const migration = readFileSync(
    "supabase/migrations/20261018_056_purchase_limit_ux.sql",
    "utf8",
  );
  assert.ok(migration.includes("account_limit_reason"));
  assert.ok(migration.includes("purchase_limit jsonb"));

  const ordersRoute = readFileSync("src/app/api/orders/route.ts", "utf8");
  assert.ok(
    ordersRoute.includes(
      "account_limit_reason: accountVerification.limitReason",
    ),
  );
});

test("inspector admin menampilkan kolom verifikasi + alasan limit", () => {
  const route = readFileSync("src/app/api/admin/orders/[id]/route.ts", "utf8");
  assert.ok(route.includes("account_verification_status"));
  assert.ok(route.includes("account_nickname"));
  assert.ok(route.includes("account_limit_reason"));
});

test("popup item limited ada di TopupExperience", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  assert.ok(ui.includes("/api/game-account/limit"));
  assert.ok(ui.includes("isLimitedPackageCandidate"));
  assert.ok(ui.includes("limit-popup-title"));
});

test("isOncePerAccountLabel: keluarga First Top Up / First Recharge", () => {
  assert.equal(isOncePerAccountLabel("First Top Up 50+Bonus Diamonds"), true);
  assert.equal(isOncePerAccountLabel("First Recharge 300 Diamonds"), true);
  assert.equal(isOncePerAccountLabel("First Purchase Bonus"), true);
  assert.equal(isOncePerAccountLabel("Top Up Pertama 100"), true);
  assert.equal(isOncePerAccountLabel("86 Diamonds"), false);
  assert.equal(isOncePerAccountLabel("Weekly Diamond Pass"), false);
  // DD ditangani jalur data supplier (eligible/limit_blocked), bukan consent.
  assert.equal(isOncePerAccountLabel("Double Diamonds 150"), false);
});

test("endpoint limit mengklasifikasi consent-required dari label produk", () => {
  const route = readFileSync("src/app/api/game-account/limit/route.ts", "utf8");
  assert.ok(route.includes("consent-required"));
  assert.ok(route.includes("isOncePerAccountLabel"));
  assert.ok(
    !route.includes("checkMelostorePurchaseLimit"),
    "endpoint wajib cache-only — popup tidak boleh membakar jatah cek (aturan RPM)",
  );
});

test("popup penolakan tanpa tombol lanjutkan; consent meminta konfirmasi", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  assert.ok(ui.includes("consent-required"));
  assert.ok(ui.includes("Akun saya belum pernah top up — lanjutkan"));
  assert.ok(ui.includes("Silakan pilih paket lain"));
  assert.ok(
    !ui.includes("Tetap lanjut"),
    "order yang pasti ditolak tidak boleh ditawari tombol lanjutkan",
  );
});

test("pesan gate verifikasi memakai register formal (Anda)", () => {
  const policy = readFileSync(
    "src/lib/account-verification-policy.ts",
    "utf8",
  );
  assert.ok(policy.includes("User ID game Anda tidak ditemukan"));
  assert.ok(policy.includes("Silakan coba lagi beberapa saat"));
  assert.ok(
    !policy.includes("User ID game kamu"),
    "register lama (kamu) tidak boleh kembali di pesan gate",
  );
});
