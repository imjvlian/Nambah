import assert from "node:assert/strict";
import test from "node:test";
import {
  nextOrderStatusFromPayment,
  normalizePaymentStatus,
} from "../src/lib/payment-status-policy.ts";

test("normalizes Midtrans payment statuses", () => {
  assert.equal(normalizePaymentStatus("settlement"), "settlement");
  assert.equal(normalizePaymentStatus("partial_refund"), "refund");
  assert.equal(normalizePaymentStatus("unexpected"), "pending");
});

test("accepted capture and settlement become paid", () => {
  assert.equal(
    nextOrderStatusFromPayment("pending_payment", {
      transactionStatus: "capture",
      fraudStatus: "accept",
    }),
    "paid",
  );
  assert.equal(
    nextOrderStatusFromPayment("pending_payment", {
      transactionStatus: "settlement",
    }),
    "paid",
  );
});

test("terminal/advanced success is not regressed by delayed pending or deny", () => {
  assert.equal(
    nextOrderStatusFromPayment("success", { transactionStatus: "pending" }),
    "success",
  );
  assert.equal(
    nextOrderStatusFromPayment("processing", { transactionStatus: "deny" }),
    "processing",
  );
  assert.equal(
    nextOrderStatusFromPayment("paid", { transactionStatus: "expire" }),
    "paid",
  );
});

test("refund overrides successful states", () => {
  assert.equal(
    nextOrderStatusFromPayment("success", { transactionStatus: "refund" }),
    "refunded",
  );
  assert.equal(
    nextOrderStatusFromPayment("processing", { transactionStatus: "partial_refund" }),
    "refunded",
  );
});
