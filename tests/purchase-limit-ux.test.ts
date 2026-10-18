import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyLimitedItem,
  formatRelativeDays,
  isLimitedPackageCandidate,
  isOncePerAccountLabel,
  parsePublicPurchaseLimit,
  popupButtonsFor,
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

test("isLimitedPackageCandidate: MLBB selalu; game lain via label limited", () => {
  // MLBB selalu cek — identitas item limited (SKU dd) tidak terlihat dari label.
  assert.equal(
    isLimitedPackageCandidate("mobile-legends", "86 Diamonds"),
    true,
  );
  assert.equal(isLimitedPackageCandidate("mobile-legends", "5 Diamond"), true);
  // Game lain: label limited saja.
  assert.equal(
    isLimitedPackageCandidate("magic-chess", "First Recharge 300 Diamonds"),
    true,
  );
  assert.equal(
    isLimitedPackageCandidate("free-fire", "Weekly Membership"),
    true,
  );
  assert.equal(
    isLimitedPackageCandidate("honor-of-kings", "80 Tokens"),
    false,
  );
  assert.equal(
    isLimitedPackageCandidate("genshin-impact", "Blessing of the Welkin Moon"),
    false,
  );
});

test("classifyLimitedItem: alias SKU dari data mapping nyata", () => {
  // Keluarga WDP (varian 1x/2x/3x).
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlidwp-s1",
      label: "Weekly Diamond Pass",
    }),
    { kind: "supplier-weekly-pass" },
  );
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlidwdp2d-s5",
      label: "Weekly Diamond Pass 2x",
    }),
    { kind: "supplier-weekly-pass" },
  );
  // FTU = double-diamonds-50 (50 + bonus 50 = 100 total).
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlid100d-s7",
      label: "First Top Up 50+Bonus Diamonds",
    }),
    { kind: "supplier-double-diamonds", packageCode: "double-diamonds-50" },
  );
  // SKU event DD — hanya flag eligible yang bisa memverifikasi.
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlid1136dd-s12a",
      label: "1136 Diamond",
    }),
    { kind: "supplier-double-diamonds", packageCode: null },
  );
  // Diamond biasa — bukan limited.
  assert.equal(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlid10d-s5",
      label: "10 Diamond",
    }),
    null,
  );
  // Twilight Pass = sekali per akun selamanya (riset: bukan bulanan).
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlidtp-s7",
      label: "Twilight Pass",
    }),
    { kind: "once-per-account", scope: "this-product" },
  );
  // Weekly Elite Pack & Monthly Elite Bundle.
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlglwep-s7",
      label: "Weekly Elite Pack",
    }),
    { kind: "periodic", windowDays: 7 },
  );
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: "mlidemb-s1",
      label: "Monthly Elite Bundle",
    }),
    { kind: "periodic", windowDays: 31 },
  );
});

test("classifyLimitedItem: fallback label + prioritas SKU atas label", () => {
  // FTU tanpa mapping Melostore → consent (any-purchase).
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "magic-chess",
      supplierSku: null,
      label: "First Recharge 300 Diamonds",
    }),
    { kind: "once-per-account", scope: "any-purchase" },
  );
  // Periodik: jendela ditentukan label.
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "free-fire",
      supplierSku: null,
      label: "Weekly Membership",
    }),
    { kind: "periodic", windowDays: 7 },
  );
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "free-fire",
      supplierSku: null,
      label: "Monthly Membership",
    }),
    { kind: "periodic", windowDays: 31 },
  );
  // Twilight via label.
  assert.deepEqual(
    classifyLimitedItem({
      gameId: "mobile-legends",
      supplierSku: null,
      label: "Twilight Pass",
    }),
    { kind: "once-per-account", scope: "this-product" },
  );
  // SKU supplier mengalahkan label once-per-account: FTU MLBB → data
  // supplier (bukan consent) — sesuai desain.
  const ftu = classifyLimitedItem({
    gameId: "mobile-legends",
    supplierSku: "mlid100d-s7",
    label: "First Top Up 50+Bonus Diamonds",
  });
  assert.equal(ftu?.kind, "supplier-double-diamonds");
  // Bukan limited.
  assert.equal(
    classifyLimitedItem({
      gameId: "free-fire",
      supplierSku: null,
      label: "50 Diamonds",
    }),
    null,
  );
});

test("popupButtonsFor: single-button hanya untuk yang pasti gagal", () => {
  assert.equal(popupButtonsFor("limit_blocked"), "single-primary");
  assert.equal(popupButtonsFor("previously-purchased"), "single-primary");
  assert.equal(popupButtonsFor("unknown"), "single-primary");
  assert.equal(popupButtonsFor("recently-purchased"), "safe-continue");
  assert.equal(popupButtonsFor("consent-required"), "cancel-continue");
});

test("formatRelativeDays: tanggal nyata untuk penilaian reset periode", () => {
  assert.equal(formatRelativeDays(null), "");
  assert.equal(formatRelativeDays("bukan-tanggal"), "");
  const tigaHari = new Date(Date.now() - 3 * 86_400_000).toISOString();
  assert.match(formatRelativeDays(tigaHari), /^3 hari lalu \(.+\)$/);
  assert.match(formatRelativeDays(new Date().toISOString()), /^hari ini/);
});

test("endpoint limit cache-only: tidak pernah memanggil Melostore", () => {
  const route = readFileSync("src/app/api/game-account/limit/route.ts", "utf8");
  assert.ok(route.includes("readCachedAccountCheck"));
  assert.ok(route.includes("decideMlbbLimitForClass"));
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

test("endpoint limit: alias + riwayat, cache-only tanpa Melostore", () => {
  const route = readFileSync("src/app/api/game-account/limit/route.ts", "utf8");
  assert.ok(route.includes("classifyLimitedItem"));
  assert.ok(route.includes("decideMlbbLimitForClass"));
  assert.ok(route.includes("consent-required"));
  assert.ok(route.includes("recently-purchased"));
  assert.ok(route.includes("previously-purchased"));
  // Riwayat: status success saja — pembelian gagal/refund tidak memblokir.
  assert.ok(route.includes('status: "eq.success"'));
  assert.ok(
    !route.includes("checkMelostorePurchaseLimit"),
    "endpoint wajib cache-only — popup tidak boleh membakar jatah cek (aturan RPM)",
  );
});

test("popup: tombol lanjutkan hanya untuk yang masih mungkin dibeli", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  // "Tetap lanjutkan" hanya milik recently-purchased (hari reset periode
  // tidak bisa dipastikan). Keputusan set-tombol per status dijaga murni
  // lewat popupButtonsFor di test terpisah.
  assert.ok(ui.includes("recently-purchased"));
  assert.ok(ui.includes("Tetap lanjutkan"));
  assert.ok(ui.includes("Pilih paket lain"));
  assert.ok(ui.includes("Akun saya belum pernah top up — lanjutkan"));
  assert.ok(ui.includes("Cek dulu di game"));
  assert.ok(ui.includes("checkout-confirm-note"));
  assert.ok(ui.includes("popupButtonsFor"));
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
