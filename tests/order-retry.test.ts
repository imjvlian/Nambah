import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildRetryPrefill,
  isRetrySafeOrder,
  retryCTALabel,
  stowRetryPrefill,
  takeRetryPrefill,
} from "../src/lib/order-retry.ts";

/**
 * P3.2 (24 Okt 2026): "Coba lagi" untuk order gagal/kedaluwarsa.
 *
 * Keputusan yang dijaga di sini adalah keputusan UANG: kapan aman
 * menawarkan coba lagi. Kuncinya `paid_at` — order `failed` mencakup
 * dua dunia yang berlawanan: bayar ditolak (tidak ada uang keluar)
 * dan fulfillment gagal setelah bayar (uang pelanggan tertahan
 * sampai refund). Tombol yang sama tidak boleh berlaku untuk keduanya.
 */

const DASAR = {
  status: "cancelled" as const,
  paidAt: null,
  product: { gameId: "mobile-legends", packageId: "mlid100d-s7" },
  account: { userId: "192676664", serverId: "57021" },
  promoCode: "WELCOME",
  referralCode: "BUDI",
};

test("isRetrySafeOrder: status yang aman — uang tidak pernah tertahan", () => {
  assert.equal(isRetrySafeOrder({ status: "cancelled", paidAt: null }), true);
  assert.equal(isRetrySafeOrder({ status: "refunded", paidAt: "2026-10-24T00:00:00Z" }), true);
  assert.equal(isRetrySafeOrder({ status: "success", paidAt: "2026-10-24T00:00:00Z" }), true);
  assert.equal(isRetrySafeOrder({ status: "awaiting_receivable", paidAt: "2026-10-24T00:00:00Z" }), true);
});

test("isRetrySafeOrder: failed tanpa paid_at = bayar ditolak — aman", () => {
  assert.equal(isRetrySafeOrder({ status: "failed", paidAt: null }), true);
});

test("isRetrySafeOrder: failed DENGAN paid_at = uang tertahan — DITOLAK", () => {
  /*
   * Pelanggan sudah membayar, fulfillment gagal. "Coba lagi" di sini
   * berarti bayar dua kali sambil refund yang pertama belum jalan.
   * Jalurnya refund, bukan retry.
   */
  assert.equal(
    isRetrySafeOrder({ status: "failed", paidAt: "2026-10-24T00:00:00Z" }),
    false,
  );
});

test("isRetrySafeOrder: status aktif tidak pernah dapat retry", () => {
  assert.equal(isRetrySafeOrder({ status: "pending_payment", paidAt: null }), false);
  assert.equal(isRetrySafeOrder({ status: "paid", paidAt: "2026-10-24T00:00:00Z" }), false);
  assert.equal(isRetrySafeOrder({ status: "processing", paidAt: "2026-10-24T00:00:00Z" }), false);
  assert.equal(isRetrySafeOrder({ status: "pending_merchant", paidAt: null }), false);
});

test("retryCTALabel: tiga label, satu perilaku", () => {
  assert.equal(retryCTALabel({ status: "failed", paidAt: null }), "Coba lagi");
  assert.equal(retryCTALabel({ status: "cancelled", paidAt: null }), "Coba lagi");
  assert.equal(
    retryCTALabel({ status: "failed", paidAt: "2026-10-24T00:00:00Z" }),
    "Buat pesanan baru",
    "failed-yang-dibayar tidak boleh terdengar seperti lanjutan",
  );
  assert.equal(retryCTALabel({ status: "success", paidAt: "x" }), "Top up lagi");
  assert.equal(retryCTALabel({ status: "refunded", paidAt: "x" }), "Top up lagi");
  assert.equal(retryCTALabel({ status: "awaiting_receivable", paidAt: "x" }), "Top up lagi");
});

test("buildRetryPrefill: field opsional hanya kalau ada isinya", () => {
  const lengkap = buildRetryPrefill(DASAR);
  assert.equal(lengkap.gameId, "mobile-legends");
  assert.equal(lengkap.packageId, "mlid100d-s7");
  assert.equal(lengkap.userId, "192676664");
  assert.equal(lengkap.serverId, "57021");
  assert.equal(lengkap.promoCode, "WELCOME");
  assert.equal(lengkap.referralCode, "BUDI");

  const tanpaOpsional = buildRetryPrefill({
    ...DASAR,
    account: { userId: "123" },
    promoCode: null,
    referralCode: null,
  });
  assert.equal("serverId" in tanpaOpsional, false);
  assert.equal("promoCode" in tanpaOpsional, false);
  assert.equal("referralCode" in tanpaOpsional, false);
});

test("storage helper aman di lingkungan tanpa sessionStorage (server)", () => {
  // Node test runner tidak punya window — helper harus gagal dengan
  // anggun, bukan melempar: navigasi pelanggan tidak boleh ikut gagal.
  assert.equal(stowRetryPrefill(DASAR), false);
  assert.equal(takeRetryPrefill(), null);
});

/*
 * ── Integrasi UI (gaya rumah: source-assertion) ────────────────────────
 */

test("halaman order: label dinamis + prefill sebelum navigasi", () => {
  const view = readFileSync("src/components/OrderStatusView.tsx", "utf8");

  assert.ok(
    view.includes("function cobaLagiDenganPrefill"),
    "satu helper untuk semua tombol new_order",
  );
  assert.ok(
    view.includes("stowRetryPrefill({"),
    "helper menulis prefill ke sessionStorage",
  );
  assert.ok(
    view.indexOf("stowRetryPrefill({") < view.indexOf('router.push("/#topup")'),
    "prefill ditulis SEBELUM navigasi — TopupEffect membacanya saat mount",
  );
  assert.ok(
    view.includes("retryCTALabel({"),
    "label tombol dihitung dari status + paidAt",
  );
  assert.ok(
    view.includes("paymentWindowClosed\n                    ? \"Coba lagi\""),
    "jendela bayar kedaluwarsa = coba lagi",
  );
});

test("halaman order: failed-yang-dibayar menunjuk ke refund, bukan retry", () => {
  const view = readFileSync("src/components/OrderStatusView.tsx", "utf8");

  // Form refund hanya untuk failed yang benar-benar sudah dibayar —
  // gagal-bayar tidak bisa refund (tidak ada uang), form cuma dead-end
  // 409 untuk mereka.
  assert.ok(
    view.includes("(liveStatus === \"failed\" && order?.payment.paidAt)"),
    "form refund digerbang paidAt",
  );
  assert.ok(
    view.includes("Pembayaranmu sudah masuk tapi pengiriman gagal"),
    "deskripsi jujur untuk kasus uang tertahan",
  );
  assert.ok(
    view.includes("Pembayaran gagal atau kedaluwarsa"),
    "deskripsi jujur untuk kasus bayar ditolak",
  );
});

test("TopupExperience: prefill saat mount, game hilang = batal, kode tidak auto-apply", () => {
  const topup = readFileSync("src/components/TopupExperience.tsx", "utf8");

  assert.ok(
    topup.includes("takeRetryPrefill()"),
    "prefill dibaca saat mount",
  );

  const effectMatch = topup.match(
    /const prefill = takeRetryPrefill\(\);[\s\S]*?\n  \}, \[games\]\)/,
  );
  assert.ok(effectMatch, "badan efek prefill harus terbaca");
  assert.ok(
    effectMatch[0].includes("if (!game) return;"),
    "game tidak ada di etalase (hilang/maintenance) -> prefill batal, pilih segar",
  );
  assert.ok(
    effectMatch[0].includes("setPromoInput(prefill.promoCode)"),
    "kode promo hanya mengisi kolom input",
  );
  assert.ok(
    !effectMatch[0].includes("setAppliedPromoCode"),
    "kode TIDAK di-apply buta — kode kedaluwarsa tidak boleh mematikan pratinjau harga",
  );
  assert.ok(
    effectMatch[0].includes("(game.packages[3] ?? game.packages[0]!).id"),
    "paket hilang jatuh ke default heuristik yang sama dengan komponen",
  );
});

test("prefill sekali pakai: dibaca lalu dihapus", () => {
  const lib = readFileSync("src/lib/order-retry.ts", "utf8");

  assert.ok(
    lib.includes("removeItem(RETRY_PREFILL_STORAGE_KEY)"),
    "prefill dihapus setelah dibaca — refresh tidak mengembalikan prefill lama",
  );
  assert.ok(
    lib.includes("try {") && lib.includes("} catch {"),
    "semua akses storage dibungkus — mode privat tidak boleh melempar",
  );
});
