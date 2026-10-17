import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAccountGate,
  decideMlbbPurchaseLimit,
  DOUBLE_DIAMONDS_INELIGIBLE_MESSAGE,
  INVALID_ACCOUNT_MESSAGE,
  VERIFICATION_UNAVAILABLE_MESSAGE,
  WEEKLY_PASS_LIMIT_MESSAGE,
  type AccountVerificationResult,
} from "../src/lib/account-verification-policy.ts";

const base: AccountVerificationResult = {
  status: "verified",
  provider: "melostore",
  nickname: "TimnasKita",
  region: null,
  checkedAt: "2026-10-17T00:00:00.000Z",
};

function withStatus(
  patch: Partial<AccountVerificationResult>,
): AccountVerificationResult {
  return { ...base, ...patch };
}

test("mode off dan log tidak pernah menolak order apa pun hasilnya", () => {
  const results: AccountVerificationResult[] = [
    base,
    withStatus({ status: "invalid" }),
    withStatus({ status: "unavailable", reason: "provider-error" }),
    withStatus({
      status: "unavailable",
      reason: "insufficient-balance",
      alarm: "insufficient-balance",
    }),
    withStatus({ status: "limit_blocked", limitReason: "weekly-pass" }),
    withStatus({ status: "not_required" }),
    withStatus({ status: "not_configured" }),
    withStatus({ status: "skipped" }),
  ];

  for (const mode of ["off", "log"] as const) {
    for (const result of results) {
      assert.deepEqual(
        decideAccountGate(result, mode),
        { allowed: true },
        `${mode} + ${result.status} harus allow`,
      );
    }
  }
});

test("mode enforce: hanya invalid, unavailable, dan limit_blocked yang menolak", () => {
  assert.deepEqual(decideAccountGate(base, "enforce"), { allowed: true });
  assert.deepEqual(
    decideAccountGate(withStatus({ status: "not_required" }), "enforce"),
    { allowed: true },
  );
  assert.deepEqual(
    decideAccountGate(withStatus({ status: "not_configured" }), "enforce"),
    { allowed: true },
  );
  assert.deepEqual(
    decideAccountGate(withStatus({ status: "skipped" }), "enforce"),
    { allowed: true },
  );

  const invalid = decideAccountGate(
    withStatus({ status: "invalid" }),
    "enforce",
  );
  assert.equal(invalid.allowed, false);
  assert.equal(invalid.status, 422);
  assert.equal(invalid.error, INVALID_ACCOUNT_MESSAGE);

  const unavailable = decideAccountGate(
    withStatus({ status: "unavailable", reason: "rate-limited" }),
    "enforce",
  );
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.error, VERIFICATION_UNAVAILABLE_MESSAGE);
});

test("mode enforce: limit_blocked MLBB punya pesan per alasan", () => {
  const weeklyPass = decideAccountGate(
    withStatus({ status: "limit_blocked", limitReason: "weekly-pass" }),
    "enforce",
  );
  assert.equal(weeklyPass.allowed, false);
  assert.equal(weeklyPass.status, 422);
  assert.equal(weeklyPass.error, WEEKLY_PASS_LIMIT_MESSAGE);

  const doubleDiamonds = decideAccountGate(
    withStatus({ status: "limit_blocked", limitReason: "double-diamonds" }),
    "enforce",
  );
  assert.equal(doubleDiamonds.allowed, false);
  assert.equal(doubleDiamonds.status, 422);
  assert.equal(doubleDiamonds.error, DOUBLE_DIAMONDS_INELIGIBLE_MESSAGE);
});

test("MLBB policy: weekly pass limit reached untuk SKU kita memblokir", () => {
  const result = decideMlbbPurchaseLimit({
    supplierSku: "MLBB_WDP_100",
    weeklyPass: [
      { packageCode: "MLBB_WDP_50", limitReached: false },
      { packageCode: "MLBB_WDP_100", limitReached: true },
    ],
    doubleDiamondsEligible: true,
  });
  assert.deepEqual(result, { ok: false, reason: "weekly-pass" });
});

test("MLBB policy: SKU lain yang limit-reached tidak memblokir SKU kita", () => {
  const result = decideMlbbPurchaseLimit({
    supplierSku: "MLBB_WDP_100",
    weeklyPass: [{ packageCode: "MLBB_WDP_50", limitReached: true }],
    doubleDiamondsEligible: true,
  });
  // SKU kita memang tidak muncul di response, jadi warn-nya absah.
  assert.deepEqual(result, {
    ok: true,
    warn: "sku-not-in-limit-response",
  });
});

test("MLBB policy: double_diamonds.eligible false memblokir", () => {
  const result = decideMlbbPurchaseLimit({
    supplierSku: "MLBB_WDP_100",
    weeklyPass: [{ packageCode: "MLBB_WDP_100", limitReached: false }],
    doubleDiamondsEligible: false,
  });
  assert.deepEqual(result, { ok: false, reason: "double-diamonds" });
});

test("MLBB policy: field double_diamonds absennya (null) tidak memblokir", () => {
  const result = decideMlbbPurchaseLimit({
    supplierSku: "MLBB_WDP_100",
    weeklyPass: [{ packageCode: "MLBB_WDP_100", limitReached: false }],
    doubleDiamondsEligible: null,
  });
  assert.deepEqual(result, { ok: true });
});

test("MLBB policy: SKU tidak muncul di response -> allow + warn (fail-open terpantau)", () => {
  const result = decideMlbbPurchaseLimit({
    supplierSku: "MLBB_TIDAK_ADA",
    weeklyPass: [{ packageCode: "MLBB_WDP_100", limitReached: true }],
    doubleDiamondsEligible: true,
  });
  assert.deepEqual(result, {
    ok: true,
    warn: "sku-not-in-limit-response",
  });
});

test("MLBB policy: tanpa SKU (flow test) atau response kosong tidak meledak", () => {
  assert.deepEqual(
    decideMlbbPurchaseLimit({
      supplierSku: null,
      weeklyPass: [],
      doubleDiamondsEligible: true,
    }),
    { ok: true },
  );

  const warn = decideMlbbPurchaseLimit({
    supplierSku: "-",
    weeklyPass: [],
    doubleDiamondsEligible: null,
  });
  assert.deepEqual(warn, { ok: true, warn: "sku-not-in-limit-response" });
});
