import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NEXT_PATH,
  optionalSafeNext,
  safeNext,
  signInHref,
} from "../src/lib/next-path.ts";
import {
  createCodeChallenge,
  createCodeVerifier,
  createPkcePair,
  isPlausibleVerifier,
} from "../src/lib/pkce.ts";

test("relative paths pass through unchanged", () => {
  assert.equal(safeNext("/akun"), "/akun");
  assert.equal(safeNext("/order/123"), "/order/123");
  assert.equal(safeNext("/"), "/");
});

test("missing values fall back to the account page", () => {
  assert.equal(safeNext(undefined), DEFAULT_NEXT_PATH);
  assert.equal(safeNext(null), DEFAULT_NEXT_PATH);
  assert.equal(safeNext(""), DEFAULT_NEXT_PATH);
});

test("absolute URLs are rejected", () => {
  assert.equal(safeNext("https://evil.example"), DEFAULT_NEXT_PATH);
  assert.equal(safeNext("http://evil.example/steal"), DEFAULT_NEXT_PATH);
});

test("protocol-relative URLs are rejected", () => {
  // new URL("//evil.example", origin) resolves to a different host, so this
  // is an open redirect even though the string starts with a slash.
  assert.equal(safeNext("//evil.example"), DEFAULT_NEXT_PATH);
  assert.equal(safeNext("//evil.example/path"), DEFAULT_NEXT_PATH);
});

test("backslash variants of protocol-relative URLs are rejected", () => {
  assert.equal(safeNext("/\\evil.example"), DEFAULT_NEXT_PATH);
  assert.equal(safeNext("/\\/evil.example"), DEFAULT_NEXT_PATH);
});

test("newline injection attempts are rejected", () => {
  assert.equal(safeNext("/akun\r\nSet-Cookie: a=b"), DEFAULT_NEXT_PATH);
  assert.equal(safeNext("/akun\nLocation: https://evil.example"), DEFAULT_NEXT_PATH);
});

test("optionalSafeNext collapses the default back to undefined", () => {
  assert.equal(optionalSafeNext("/akun"), "/akun");
  assert.equal(optionalSafeNext(undefined), undefined);
  // An attacker-supplied value that fails validation must not survive as a
  // truthy string that looks usable further down.
  assert.equal(optionalSafeNext("https://evil.example"), undefined);
});

test("signInHref omits a redundant next parameter", () => {
  assert.equal(signInHref("/login", "/akun"), "/login?next=%2Fakun");
  assert.equal(signInHref("/login", undefined), "/login");
  assert.equal(signInHref("/register", DEFAULT_NEXT_PATH), "/register");
  assert.equal(signInHref("/register", "https://evil.example"), "/register");
});

test("verifiers are unique and high entropy", () => {
  const values = new Set(Array.from({ length: 50 }, createCodeVerifier));
  assert.equal(values.size, 50);
  for (const value of values) {
    assert.equal(isPlausibleVerifier(value), true);
    // 32 random bytes in base64url is 43 characters.
    assert.equal(value.length, 43);
  }
});

test("the challenge is derived from the verifier", () => {
  const verifier = createCodeVerifier();
  const first = createCodeChallenge(verifier);
  const second = createCodeChallenge(verifier);
  assert.equal(first, second);
  assert.notEqual(first, createCodeChallenge(createCodeVerifier()));
});

test("the challenge is url safe and unpadded", () => {
  const challenge = createCodeChallenge(createCodeVerifier());
  assert.match(challenge, /^[A-Za-z0-9\-_]+$/);
  assert.equal(challenge.includes("="), false);
  assert.equal(challenge.includes("+"), false);
  assert.equal(challenge.includes("/"), false);
});

test("the challenge matches the RFC 7636 reference vector", () => {
  // From RFC 7636 appendix B. If this passes, the hashing and encoding match
  // the specification rather than merely being self-consistent.
  assert.equal(
    createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("createPkcePair returns a matching verifier and challenge", () => {
  const { verifier, challenge } = createPkcePair();
  assert.equal(isPlausibleVerifier(verifier), true);
  assert.equal(createCodeChallenge(verifier), challenge);
});

test("implausible verifiers are rejected before reaching Supabase", () => {
  assert.equal(isPlausibleVerifier(""), false);
  assert.equal(isPlausibleVerifier("short"), false);
  // Standard base64 characters that base64url does not use.
  assert.equal(isPlausibleVerifier("a".repeat(42) + "="), false);
  assert.equal(isPlausibleVerifier("a".repeat(42) + "+"), false);
  assert.equal(isPlausibleVerifier("a".repeat(42) + "/"), false);
  assert.equal(isPlausibleVerifier("a".repeat(129)), false);
  assert.equal(isPlausibleVerifier("a".repeat(43)), true);
  assert.equal(isPlausibleVerifier("a".repeat(128)), true);
});