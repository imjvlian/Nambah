import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminSessionValue,
  isAdminApiConfigured,
  verifyAdminToken,
} from "../src/lib/admin-api.ts";

const ENV_KEYS = [
  "NODE_ENV",
  "NAMBAH_ADMIN_API_TOKEN",
  "NAMBAH_ADMIN_SESSION_SECRET",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  savedEnv.set(key, process.env[key]);
}

test.beforeEach(() => {
  process.env.NODE_ENV = "production";
  delete process.env.NAMBAH_ADMIN_API_TOKEN;
  delete process.env.NAMBAH_ADMIN_SESSION_SECRET;
});

test.afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("production rejects a short admin token", () => {
  process.env.NAMBAH_ADMIN_API_TOKEN = "short-token";

  assert.equal(verifyAdminToken("short-token"), false);
  assert.equal(isAdminApiConfigured(), false);
});

test("production accepts a long admin token", () => {
  const token = "a".repeat(48);
  process.env.NAMBAH_ADMIN_API_TOKEN = token;

  assert.equal(verifyAdminToken(token), true);
  assert.equal(isAdminApiConfigured(), true);
  assert.match(createAdminSessionValue({ mode: "legacy" }), /\./);
});

test("production rejects a short session secret", () => {
  process.env.NAMBAH_ADMIN_API_TOKEN = "a".repeat(48);
  process.env.NAMBAH_ADMIN_SESSION_SECRET = "short-secret";

  assert.equal(isAdminApiConfigured(), false);
});

test("production accepts a long session secret", () => {
  process.env.NAMBAH_ADMIN_API_TOKEN = "a".repeat(48);
  process.env.NAMBAH_ADMIN_SESSION_SECRET = "b".repeat(48);

  assert.equal(isAdminApiConfigured(), true);
});
