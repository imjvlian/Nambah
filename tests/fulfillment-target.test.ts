import assert from "node:assert/strict";
import test from "node:test";
import { renderFulfillmentTarget } from "../src/lib/fulfillment-target.ts";

test("renders user-only fulfillment target", () => {
  assert.deepEqual(
    renderFulfillmentTarget("{user_id}", { userId: "123456" }),
    { customerNo: "123456", allowDot: false },
  );
});

test("renders user and server target", () => {
  assert.equal(
    renderFulfillmentTarget("{user_id}|{server_id}", {
      userId: "123456",
      serverId: "7890",
      requiresServer: true,
    }).customerNo,
    "123456|7890",
  );
});

test("rejects unsafe or incomplete templates", () => {
  assert.throws(() => renderFulfillmentTarget("", { userId: "123" }));
  assert.throws(() =>
    renderFulfillmentTarget("{user_id}", {
      userId: "123",
      serverId: "456",
      requiresServer: true,
    }),
  );
  assert.throws(() =>
    renderFulfillmentTarget("{user_id}{password}", { userId: "123" }),
  );
});
