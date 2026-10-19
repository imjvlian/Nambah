import assert from "node:assert/strict";
import test from "node:test";
import {
  checkMelostoreNickname,
  checkMelostorePurchaseLimit,
} from "../src/lib/suppliers/melostore-client.ts";

/**
 * Kontrak tri-state check-nickname Melostore, dikunci lewat stub fetch.
 *
 * Pemetaan status HTTP adalah inti gerbang checkout — salah baca 404
 * sebagai "gangguan" berarti ID invalid lolos, salah baca 402 sebagai
 * "invalid" berarti order ditolak padahal akunnya valid.
 */

const simpanApi = process.env.MELOSTORE_API_KEY;
const simpanSecret = process.env.MELOSTORE_SECRET_KEY;

function pasangEnvTes() {
  process.env.MELOSTORE_API_KEY = "test-key";
  process.env.MELOSTORE_SECRET_KEY = "test-secret";
}

function pulihkanEnv() {
  if (simpanApi !== undefined) process.env.MELOSTORE_API_KEY = simpanApi;
  else delete process.env.MELOSTORE_API_KEY;
  if (simpanSecret !== undefined) {
    process.env.MELOSTORE_SECRET_KEY = simpanSecret;
  } else delete process.env.MELOSTORE_SECRET_KEY;
}

function stubFetch(
  handler: (
    input: unknown,
    init?: RequestInit,
  ) => Response | Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
    handler(input, init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonStatus(status: number, body: unknown) {
  return Response.json(body, { status });
}

test("200 dengan username = verified, body memakai nama field Melostore", async () => {
  pasangEnvTes();
  const restore = stubFetch((_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    assert.equal(body.game_code, "mobile-legends");
    assert.equal(body.customer_target, "12345678");
    assert.equal(body.customer_target_zone, "1234");
    assert.equal(
      (init?.headers as Record<string, string>)["X-API-Key"],
      "test-key",
    );
    return jsonStatus(200, {
      success: true,
      data: { username: "TimnasKita", region: "ID", region_type: "country" },
    });
  });

  try {
    const result = await checkMelostoreNickname({
      gameCode: "mobile-legends",
      userId: "12345678",
      zoneId: "1234",
    });
    assert.deepEqual(result, {
      outcome: "verified",
      username: "TimnasKita",
      region: "ID",
    });
  } finally {
    restore();
    pulihkanEnv();
  }
});

test("zone opsional: tanpa zoneId, field customer_target_zone tidak dikirim", async () => {
  pasangEnvTes();
  const restore = stubFetch((_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    assert.equal("customer_target_zone" in body, false);
    return jsonStatus(200, { success: true, data: { username: "Joko" } });
  });

  try {
    const result = await checkMelostoreNickname({
      gameCode: "free-fire",
      userId: "12345678",
    });
    // Region absen dari respons -> null (bukan error, bukan string kosong).
    assert.deepEqual(result, {
      outcome: "verified",
      username: "Joko",
      region: null,
    });
  } finally {
    restore();
    pulihkanEnv();
  }
});

test("404 = invalid; bukan gangguan provider", async () => {
  pasangEnvTes();
  const restore = stubFetch(() =>
    jsonStatus(404, {
      success: false,
      error_code: "4001",
      message: "User ID tidak ditemukan",
    }),
  );

  try {
    const result = await checkMelostoreNickname({
      gameCode: "mobile-legends",
      userId: "99999999",
      zoneId: "1234",
    });
    assert.deepEqual(result, { outcome: "invalid" });
  } finally {
    restore();
    pulihkanEnv();
  }
});

test("402 = insufficient-balance; 429 = rate-limited; 401 = auth", async () => {
  pasangEnvTes();
  const kasus: Array<[number, "insufficient-balance" | "rate-limited" | "auth"]> = [
    [402, "insufficient-balance"],
    [429, "rate-limited"],
    [401, "auth"],
  ];

  try {
    for (const [status, expected] of kasus) {
      const restore = stubFetch(() =>
        jsonStatus(status, { success: false, error_code: String(status) }),
      );
      try {
        const result = await checkMelostoreNickname({
          gameCode: "free-fire",
          userId: "12345678",
        });
        assert.deepEqual(
          result,
          { outcome: "unavailable", reason: expected },
          `status ${status}`,
        );
      } finally {
        restore();
      }
    }
  } finally {
    pulihkanEnv();
  }
});

test("5xx, body aneh, dan gagal jaringan semuanya provider-error", async () => {
  pasangEnvTes();

  const restore500 = stubFetch(() =>
    jsonStatus(500, { success: false, error_code: "4007" }),
  );
  try {
    assert.deepEqual(await checkMelostoreNickname({ gameCode: "free-fire", userId: "1" }), {
      outcome: "unavailable",
      reason: "provider-error",
    });
  } finally {
    restore500();
  }

  const restoreBadJson = stubFetch(() =>
    new Response("<html>gateway error</html>", { status: 502 }),
  );
  try {
    assert.deepEqual(await checkMelostoreNickname({ gameCode: "free-fire", userId: "1" }), {
      outcome: "unavailable",
      reason: "provider-error",
    });
  } finally {
    restoreBadJson();
  }

  const restoreNetwork = stubFetch(() => {
    throw new Error("ECONNRESET");
  });
  try {
    assert.deepEqual(await checkMelostoreNickname({ gameCode: "free-fire", userId: "1" }), {
      outcome: "unavailable",
      reason: "provider-error",
    });
  } finally {
    restoreNetwork();
    pulihkanEnv();
  }
});

test("tanpa env kredensial tidak pernah menyentuh jaringan", async () => {
  delete process.env.MELOSTORE_API_KEY;
  delete process.env.MELOSTORE_SECRET_KEY;
  try {
    const result = await checkMelostoreNickname({
      gameCode: "free-fire",
      userId: "1",
    });
    assert.deepEqual(result, { outcome: "unavailable", reason: "auth" });
  } finally {
    pulihkanEnv();
  }
});

test("purchase-limit: 200 mem-parsing username, weekly_pass, double_diamonds", async () => {
  pasangEnvTes();
  const restore = stubFetch((_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    assert.equal(body.customer_target, "12345678");
    assert.equal(body.customer_target_zone, "1234");
    return jsonStatus(200, {
      success: true,
      data: {
        username: "TimnasKita",
        // Docs tidak menjanjikan region di purchase-limit; parse-nya
        // defensif - kalau dikirim, ia harus mengalir.
        region: "ID",
        weekly_pass: {
          limit_reached: false,
          items: [
            { package_code: "MLBB_WDP_100", limit_reached: true },
            { package_code: "MLBB_WDP_50" },
          ],
        },
        double_diamonds: {
          eligible: false,
          items: [
            { package_code: "double-diamonds-50", limit_reached: true },
            { package_code: "double-diamonds-150", limit_reached: true },
          ],
        },
      },
    });
  });

  try {
    const result = await checkMelostorePurchaseLimit({
      userId: "12345678",
      zoneId: "1234",
    });

    assert.equal(result.outcome, "verified");
    if (result.outcome === "verified") {
      assert.equal(result.username, "TimnasKita");
      assert.equal(result.region, "ID");
      assert.deepEqual(result.weeklyPass, [
        { packageCode: "MLBB_WDP_100", limitReached: true },
        // Item tanpa limit_reached jatuh ke nilai top-level (false).
        { packageCode: "MLBB_WDP_50", limitReached: false },
      ]);
      assert.equal(result.doubleDiamondsEligible, false);
      assert.deepEqual(result.doubleDiamonds, [
        { packageCode: "double-diamonds-50", limitReached: true },
        { packageCode: "double-diamonds-150", limitReached: true },
      ]);
    }
  } finally {
    restore();
    pulihkanEnv();
  }
});

test("purchase-limit: field double_diamonds absen -> null, bukan false", async () => {
  pasangEnvTes();
  const restore = stubFetch(() =>
    jsonStatus(200, {
      success: true,
      data: { username: "TimnasKita", weekly_pass: { items: [] } },
    }),
  );

  try {
    const result = await checkMelostorePurchaseLimit({
      userId: "12345678",
      zoneId: "1234",
    });
    assert.equal(result.outcome, "verified");
    if (result.outcome === "verified") {
      assert.equal(result.doubleDiamondsEligible, null);
      assert.deepEqual(result.weeklyPass, []);
      assert.deepEqual(result.doubleDiamonds, []);
    }
  } finally {
    restore();
    pulihkanEnv();
  }
});

test("purchase-limit: 404 tetap invalid", async () => {
  pasangEnvTes();
  const restore = stubFetch(() =>
    jsonStatus(404, { success: false, error_code: "4001" }),
  );

  try {
    const result = await checkMelostorePurchaseLimit({
      userId: "99999999",
      zoneId: "1234",
    });
    assert.deepEqual(result, { outcome: "invalid" });
  } finally {
    restore();
    pulihkanEnv();
  }
});
