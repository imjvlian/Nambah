import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";

import {
  createPaylabsSignature,
  getPaylabsConfig,
  verifyPaylabsSignature,
} from "../src/lib/payments/paylabs.ts";
import { isPaylabsConfigured } from "../src/lib/payment-settings.ts";

const ENV_KEYS = [
  "PAYLABS_ENV",
  "PAYLABS_ROOT_URL",
  "PAYLABS_MERCHANT_ID",
  "PAYLABS_PARTNER_ID",
  "PAYLABS_PRIVATE_KEY",
  "PAYLABS_PUBLIC_KEY",
  "PAYLABS_NOTIFY_URL",
  "PAYLABS_DEFAULT_VA_PAYMENT_TYPE",
] as const;

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const savedEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  savedEnv.set(key, process.env[key]);
}

test.beforeEach(() => {
  for (const key of ENV_KEYS) {
    process.env[key] = "";
  }

  process.env.PAYLABS_ENV = "production";
  process.env.PAYLABS_ROOT_URL = "https://api.example.com";
  process.env.PAYLABS_MERCHANT_ID = "merchant-001";
  process.env.PAYLABS_PRIVATE_KEY = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  process.env.PAYLABS_PUBLIC_KEY = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
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

test("production Paylabs config requires a public key", () => {
  delete process.env.PAYLABS_PUBLIC_KEY;

  assert.equal(isPaylabsConfigured(), false);
  assert.equal(getPaylabsConfig(), null);
});

test("production Paylabs config is accepted with a valid public key", () => {
  assert.equal(isPaylabsConfigured(), true);
  assert.notEqual(getPaylabsConfig(), null);
});

test("sandbox Paylabs config still works without a public key", () => {
  process.env.PAYLABS_ENV = "sandbox";
  delete process.env.PAYLABS_PUBLIC_KEY;

  assert.equal(isPaylabsConfigured(), true);
  assert.notEqual(getPaylabsConfig(), null);
});

test("Paylabs webhook signature can be signed and verified", () => {
  const body = { merchantTradeNo: "NBH-20261016-ABCDEF", status: "02" };
  const timestamp = "2026-10-16T10:00:00.000+07:00";
  const path = "/api/webhooks/paylabs";

  const signature = createPaylabsSignature({
    method: "POST",
    path,
    body,
    timestamp,
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });

  assert.equal(
    verifyPaylabsSignature({
      method: "POST",
      path,
      body: JSON.stringify(body),
      timestamp,
      signature,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }),
    true,
  );
});

test("Paylabs webhook signature rejects a different body", () => {
  const body = { merchantTradeNo: "NBH-20261016-ABCDEF", status: "02" };
  const timestamp = "2026-10-16T10:00:00.000+07:00";
  const path = "/api/webhooks/paylabs";

  const signature = createPaylabsSignature({
    method: "POST",
    path,
    body,
    timestamp,
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });

  assert.equal(
    verifyPaylabsSignature({
      method: "POST",
      path,
      body: JSON.stringify({ ...body, status: "09" }),
      timestamp,
      signature,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }),
    false,
  );
});
