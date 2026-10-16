import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { refundStatusText } from "../src/lib/refund-status-text.ts";

const baseRefund = {
  id: 1,
  order_id: "NBH-20261016-TEST",
  provider: "midtrans",
  provider_refund_id: "refund-midtrans-NBH-20261016-TEST",
  amount: 40_000,
  reason: "Produk gagal terkirim",
  status: "completed",
  requested_by_admin_user_id: null,
  processed_by_admin_user_id: null,
  provider_response: null,
  request_note: null,
  completed_note: null,
  requested_at: "2026-10-16T00:00:00Z",
  processed_at: "2026-10-16T01:00:00Z",
  created_at: "2026-10-16T00:00:00Z",
  updated_at: "2026-10-16T01:00:00Z",
};

test("refund migration enforces one refund per order", () => {
  const migration = readFileSync(
    "supabase/migrations/20261016_053_refund_flow.sql",
    "utf8",
  );

  assert.match(migration, /order_id text not null unique/);
  assert.match(migration, /status text not null default 'requested'/);
  assert.match(migration, /enable row level security/);
});

test("admin refund route is guarded and audited", () => {
  const route = readFileSync(
    "src/app/api/admin/orders/[id]/refund/route.ts",
    "utf8",
  );

  assert.ok(route.includes("authorizeAdminRequest(request, { superadminOnly: true })"));
  assert.ok(route.includes("auditAdminAction(request"));
});

test("customer refund route checks order access", () => {
  const route = readFileSync(
    "src/app/api/orders/[id]/refund/route.ts",
    "utf8",
  );

  assert.ok(route.includes("verifyOrderAccess(orderId, token)"));
  assert.ok(route.includes("isOrderOwnedByUser(orderId, auth.user.id)"));
});

test("customer refund responses never leak internal refund fields", () => {
  const route = readFileSync(
    "src/app/api/orders/[id]/refund/route.ts",
    "utf8",
  );

  // Route harus memetakan ke subset eksplisit, bukan menyerahkan baris DB.
  assert.ok(route.includes("const publicRefund = refund"));
  assert.ok(route.includes("const publicRefund = {"));
  assert.ok(!route.includes("provider_response"));
  assert.ok(!route.includes("requested_by_admin_user_id"));
});

test("public order payload drops the refund reason field", () => {
  const orderPublic = readFileSync("src/lib/order-public.ts", "utf8");
  const orderService = readFileSync("src/lib/order-service.ts", "utf8");

  // Alasan refund bisa berisi catatan internal admin — jangan pernah
  // sampai ke browser pembeli.
  const refundTypeMatch = orderPublic.match(/refund\?:\s*\{[\s\S]*?\};/);
  assert.ok(refundTypeMatch, "Tipe refund di PublicOrder harus ada.");
  assert.ok(!refundTypeMatch[0].includes("reason"));
  assert.ok(
    !orderService.includes(
      '"status,provider,amount,reason,requested_at,processed_at"',
    ),
  );
});

test("admin route can process a refund the customer already requested", () => {
  const route = readFileSync(
    "src/app/api/admin/orders/[id]/refund/route.ts",
    "utf8",
  );

  // Tombol Refund admin tidak boleh terjebak 409 kalau customer
  // mengajukan duluan dari halaman order.
  assert.ok(route.includes("getRefundForOrder(orderId)"));
  assert.ok(route.includes("existing-request"));
  assert.ok(route.includes('"confirm-completed"'));
});

test("refund service handles duplicate insert races", () => {
  const service = readFileSync("src/lib/refund-service.ts", "utf8");

  assert.ok(/duplicate key|unique constraint|23505/i.test(service));
  assert.ok(
    service.includes('"Order ini sudah punya permintaan refund."'),
  );
});

test("midtrans refund success requires a refund_chargeback_id", () => {
  const service = readFileSync("src/lib/refund-service.ts", "utf8");

  // 2xx tanpa refund_chargeback_id berarti Midtrans tidak benar-benar
  // membuat refund — harus dianggap gagal (fail-closed).
  assert.ok(service.includes("refund_chargeback_id"));
  assert.ok(
    service.includes(
      "Midtrans refund tidak mengembalikan refund_chargeback_id",
    ),
  );
});

test("settlement failures never mark a completed refund as failed", () => {
  const service = readFileSync("src/lib/refund-service.ts", "utf8");

  // Setelah baris refund completed, kegagalan status order/email/telegram
  // hanya boleh dicatat — bukan membalikkan status refund.
  assert.ok(service.includes("settleRefundedOrder"));
  assert.ok(
    service.includes(
      "Refund order ${input.orderId} selesai, tapi status order gagal diubah menjadi refunded",
    ),
  );
  const settleMatch = service.match(
    /async function settleRefundedOrder\([\s\S]*?\n\}/,
  );
  assert.ok(settleMatch, "Helper settleRefundedOrder harus ada.");
  assert.ok(!settleMatch[0].includes('status: "failed"'));
});

test("completed refund status is customer-facing", () => {
  const text = refundStatusText(baseRefund);
  assert.match(text, /Refund/);
  assert.match(text, /Rp\s?40\.000/);
});

test("failed refund status includes the original reason", () => {
  const text = refundStatusText({ ...baseRefund, status: "failed" });
  assert.match(text, /Refund gagal diproses/);
  assert.match(text, /Produk gagal terkirim/);
});
