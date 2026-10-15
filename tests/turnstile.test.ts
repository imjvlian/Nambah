import assert from "node:assert/strict";
import test from "node:test";

import {
  getClientIp,
  verifyTurnstileToken,
} from "../src/lib/turnstile.ts";

test.beforeEach(() => {
  // Keep each test isolated from test-only environment changes.
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  process.env.NODE_ENV = "production";
});

test("rejects blank token before any network request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called for blank token");
  };

  try {
    assert.equal((await verifyTurnstileToken("   ")).success, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed in production when the secret is missing", async () => {
  assert.equal((await verifyTurnstileToken("token-123")).success, false);
});

test("accepts a successful Cloudflare response for an allowed hostname", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "secret-test";
  globalThis.fetch = async (_input, init) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    assert.equal(body.get("secret"), "secret-test");
    assert.equal(body.get("response"), "token-123");
    assert.equal(body.get("remoteip"), "198.51.100.1");

    return Response.json({
      success: true,
      hostname: "nambah.my.id",
      "error-codes": [],
    });
  };

  try {
    assert.equal(
      (await verifyTurnstileToken("token-123", "198.51.100.1")).success,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("rejects a Cloudflare error response", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "secret-test";
  globalThis.fetch = async () =>
    Response.json({
      success: false,
      hostname: "nambah.my.id",
      "error-codes": ["invalid-input-response"],
    });

  try {
    assert.equal((await verifyTurnstileToken("token-123")).success, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("rejects a successful response from an unexpected hostname", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "secret-test";
  globalThis.fetch = async () =>
    Response.json({ success: true, hostname: "evil.example" });

  try {
    assert.equal((await verifyTurnstileToken("token-123")).success, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("ignores malformed remote IPs without error", () => {
  assert.equal(getClientIp(new Request("https://nambah.my.id", { headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.2" } })), "203.0.113.7");
  assert.equal(getClientIp(new Request("https://nambah.my.id")), "");
});
