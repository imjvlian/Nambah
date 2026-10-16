import assert from "node:assert/strict";
import test from "node:test";

import { contentSecurityPolicy } from "../src/lib/csp.ts";

test("production CSP uses a nonce and does not allow unsafe-inline scripts", () => {
  process.env.NODE_ENV = "production";
  const csp = contentSecurityPolicy("test-nonce");

  assert.match(csp, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /app\.sandbox\.midtrans\.com/);
});

test("development CSP still allows inline scripts and eval", () => {
  process.env.NODE_ENV = "development";
  const csp = contentSecurityPolicy("test-nonce");

  assert.match(csp, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(csp, /app\.sandbox\.midtrans\.com/);
});
