import assert from "node:assert/strict";
import test from "node:test";

import { contentSecurityPolicy } from "../src/lib/csp.ts";

test("production CSP uses a nonce and does not allow unsafe-inline scripts", () => {
  process.env.NODE_ENV = "production";
  const csp = contentSecurityPolicy("test-nonce");

  assert.match(csp, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /app\.sandbox\.midtrans\.com/);
  assert.doesNotMatch(csp, /img-src[^;]*https:(?!\/\/)/);
});

test("development CSP still allows inline scripts and eval", () => {
  process.env.NODE_ENV = "development";
  const csp = contentSecurityPolicy("test-nonce");

  assert.match(csp, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(csp, /app\.sandbox\.midtrans\.com/);
});

test("AdSense ad content domains allowed outside script-src in production", () => {
  process.env.NODE_ENV = "production";
  const csp = contentSecurityPolicy("test-nonce");

  assert.match(csp, /frame-src[^;]*googleads\.g\.doubleclick\.net/);
  assert.match(csp, /frame-src[^;]*tpc\.googlesyndication\.com/);
  assert.match(csp, /connect-src[^;]*pagead2\.googlesyndication\.com/);
  assert.match(csp, /img-src[^;]*tpc\.googlesyndication\.com/);

  // Invariant penting: di production loader AdSense TIDAK boleh
  // mengandalkan allowlist host — 'strict-dynamic' mengabaikannya, jadi
  // satu-satunya jalur yang sah adalah nonce per-request (AdSenseScript).
  // Sengaja di-lock supaya tanpa disadari tidak ada host domain iklan
  // terselip di script-src production.
  assert.doesNotMatch(csp, /script-src[^;]*googlesyndication/);
});

test("development CSP allows the AdSense loader by host (no strict-dynamic)", () => {
  process.env.NODE_ENV = "development";
  const csp = contentSecurityPolicy("test-nonce");

  assert.match(
    csp,
    /script-src 'self' 'unsafe-inline' 'unsafe-eval'[^;]*pagead2\.googlesyndication\.com/,
  );
});
