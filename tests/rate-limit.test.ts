import assert from "node:assert/strict";
import test from "node:test";
import { anonymizedKey } from "../src/lib/rate-limit.ts";

function makeRequest(
  options: {
    ip?: string;
    agent?: string;
  } = {},
) {
  return new Request("https://nambah.my.id/api/auth/verify-signup", {
    headers: {
      "x-forwarded-for": options.ip ?? "203.0.113.10",
      "user-agent": options.agent ?? "Mozilla/5.0 (test)",
    },
  });
}

test("the same request and scope produce the same key", () => {
  const a = anonymizedKey(makeRequest(), "auth-verify-signup-email");
  const b = anonymizedKey(makeRequest(), "auth-verify-signup-email");
  assert.equal(a, b);
});

test("different scopes produce different keys", () => {
  const a = anonymizedKey(makeRequest(), "auth-verify-signup-email");
  const b = anonymizedKey(makeRequest(), "auth-verify-signup-ip");
  assert.notEqual(a, b);
});

test("different IPs produce different keys", () => {
  const a = anonymizedKey(makeRequest({ ip: "203.0.113.10" }), "scope");
  const b = anonymizedKey(makeRequest({ ip: "203.0.113.11" }), "scope");
  assert.notEqual(a, b);
});

test("the same subject produces the same key across different IPs", () => {
  const a = anonymizedKey(
    makeRequest({ ip: "203.0.113.10" }),
    "scope",
    "same@example.com",
  );
  const b = anonymizedKey(
    makeRequest({ ip: "203.0.113.11" }),
    "scope",
    "same@example.com",
  );
  assert.equal(a, b);
});

test("the subject changes the key", () => {
  // This is the whole point of adding it: two people verifying codes from the
  // same machine must not share a counter.
  const a = anonymizedKey(makeRequest(), "scope", "satu@example.com");
  const b = anonymizedKey(makeRequest(), "scope", "dua@example.com");
  assert.notEqual(a, b);
});

test("the subject is matched case-insensitively and after trimming", () => {
  const a = anonymizedKey(makeRequest(), "scope", "  EMAIL@example.com  ");
  const b = anonymizedKey(makeRequest(), "scope", "email@EXAMPLE.com");
  assert.equal(a, b);
});

test("an absent subject and an empty subject agree", () => {
  const a = anonymizedKey(makeRequest(), "scope");
  const b = anonymizedKey(makeRequest(), "scope", "");
  assert.equal(a, b);
});

test("whitespace-only subjects fall back to the plain key", () => {
  const a = anonymizedKey(makeRequest(), "scope", "   ");
  const b = anonymizedKey(makeRequest(), "scope");
  assert.equal(a, b);
});

test("an overly long subject is truncated before hashing", () => {
  const long = "x".repeat(400);
  const a = anonymizedKey(makeRequest(), "scope", long);
  const b = anonymizedKey(makeRequest(), "scope", long.slice(0, 254));
  assert.equal(a, b);
});

test("the key never contains the raw subject", () => {
  const key = anonymizedKey(makeRequest(), "scope", "rahasia@example.com");
  assert.equal(key.includes("rahasia@example.com"), false);
  assert.match(key, /^[0-9a-f]{64}$/);
});
