import assert from "node:assert/strict";
import test from "node:test";
import { gatewayTimeToUtcIso } from "../src/lib/gateway-time.ts";

/**
 * Bug nyata yang dikunci di sini: paid_at order NBH-20261017-5F860649E9
 * tersimpan 13:14:50+00 padahal bayarannya 06:14:50 UTC - jam WIB Midtrans
 * disimpan mentah berlabel UTC. Setiap waktu gateway tanpa offset harus
 * diasumsikan WIB dan dikonversi ke UTC.
 */

test("waktu gateway tanpa offset diasumsikan WIB (+07:00)", () => {
  assert.equal(
    gatewayTimeToUtcIso("2026-10-17 13:14:50"),
    "2026-10-17T06:14:50.000Z",
  );
  assert.equal(
    gatewayTimeToUtcIso("2026-10-17T13:14:50"),
    "2026-10-17T06:14:50.000Z",
  );
});

test("string yang sudah punya offset dihormati, tidak diasumsikan WIB", () => {
  assert.equal(
    gatewayTimeToUtcIso("2026-10-17T13:14:50+07:00"),
    "2026-10-17T06:14:50.000Z",
  );
  assert.equal(
    gatewayTimeToUtcIso("2026-10-17T06:14:50Z"),
    "2026-10-17T06:14:50.000Z",
  );
  assert.equal(
    gatewayTimeToUtcIso("2026-10-17T06:14:50+00:00"),
    "2026-10-17T06:14:50.000Z",
  );
});

test("null, kosong, dan sampah mengembalikan null - bukan throw", () => {
  assert.equal(gatewayTimeToUtcIso(null), null);
  assert.equal(gatewayTimeToUtcIso(undefined), null);
  assert.equal(gatewayTimeToUtcIso("  "), null);
  assert.equal(gatewayTimeToUtcIso("bukan-waktu"), null);
});
