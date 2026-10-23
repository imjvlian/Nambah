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

/*
 * P3.0 (23 Okt 2026): admin harus tahu saat permintaan refund MASUK,
 * bukan hanya saat kebetulan membuka inspector.
 */

test("P3.0: alert permintaan refund baru masuk antrean Telegram", () => {
  const alerts = readFileSync("src/lib/telegram-alerts.ts", "utf8");

  assert.ok(
    alerts.includes("export async function notifyRefundRequested"),
    "fungsi alert permintaan refund harus ada",
  );
  // Slice antar-marker: regex fungsi gampang berhenti di '}' penutup
  // tipe parameter (kolom 0), jadi badan fungsi dibaca lewat batas eksplisit.
  const start = alerts.indexOf("export async function notifyRefundRequested");
  const end = alerts.indexOf("export async function notifyRefundProcessed");
  assert.ok(start >= 0 && end > start, "badan fungsi notifyRefundRequested harus terbaca");
  const fnBody = alerts.slice(start, end);

  // Alasan = teks bebas pelanggan: wajib di-escape HTML supaya tidak
  // merusak format pesan (atau menyuntik markup) di Telegram.
  assert.ok(
    fnBody.includes("escapeTelegramHtml(reasonText)"),
    "alasan pelanggan harus di-escape",
  );
  assert.ok(
    fnBody.includes(".slice(0, 200)"),
    "alasan dipotong supaya pesan tetap rapi",
  );
  // Sumber permintaan dibedakan — admin-initiated tidak urgent seperti pelanggan.
  assert.ok(
    fnBody.includes('input.requestedByAdmin ? "admin" : "pelanggan"'),
    "pesan menyebut siapa pengajuannya",
  );
  // Satu alert per order: refunds.order_id unik, dedupe menahan retry submit ganda.
  assert.ok(
    fnBody.includes("dedupeKey: `refund-requested:${input.orderId}`"),
    "dedupe per order",
  );
  assert.ok(
    fnBody.includes("if (!isTelegramConfigured())"),
    "tetap senyap saat Telegram belum dikonfigurasi",
  );
});

test("P3.0: hook alert di requestRefundForOrder bersifat best-effort", () => {
  const service = readFileSync("src/lib/refund-service.ts", "utf8");

  // Alert dipanggil SETELAH baris refund tersimpan — keberhasilannya
  // tidak boleh menggagalkan permintaan yang sudah valid.
  const hookMatch = service.match(
    /await notifyRefundRequested\(\{[\s\S]*?\}\);/,
  );
  assert.ok(hookMatch, "notifyRefundRequested dipanggil");
  assert.ok(
    service.indexOf("await notifyRefundRequested") >
      service.indexOf('status: "requested"'),
    "alert terjadi setelah baris refund dibuat, bukan sebelum",
  );

  const tryMatch = service.match(
    /try \{\s*await notifyRefundRequested\([\s\S]*?\} catch \(error\) \{/,
  );
  assert.ok(
    tryMatch,
    "panggilan dibungkus try/catch — kegagalan antrean tidak menolak refund",
  );
  assert.ok(
    service.includes("Refund-requested Telegram alert failed"),
    "kegagalan alert dicatat di log server",
  );
  assert.ok(
    service.includes("requestedByAdmin: input.requestedByAdminUserId != null"),
    "sumber pengajuan diteruskan ke alert",
  );
});
