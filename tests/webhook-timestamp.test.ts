import assert from "node:assert/strict";
import test from "node:test";

import {
  WEBHOOK_TIMESTAMP_TOLERANCE_MS,
  isFreshWebhookTimestamp,
} from "../src/lib/webhook-timestamp.ts";

const NOW = Date.parse("2026-10-16T12:00:00.000+07:00");

test("accepts a webhook timestamp inside the tolerance window", () => {
  const fresh = new Date(
    NOW - WEBHOOK_TIMESTAMP_TOLERANCE_MS + 1_000,
  ).toISOString();
  assert.equal(isFreshWebhookTimestamp(fresh, NOW), true);
});

test("rejects a webhook timestamp outside the tolerance window", () => {
  const stale = new Date(
    NOW - WEBHOOK_TIMESTAMP_TOLERANCE_MS - 1_000,
  ).toISOString();
  assert.equal(isFreshWebhookTimestamp(stale, NOW), false);
});

test("rejects malformed and missing timestamps", () => {
  assert.equal(isFreshWebhookTimestamp("", NOW), false);
  assert.equal(isFreshWebhookTimestamp("not-a-timestamp", NOW), false);
});
