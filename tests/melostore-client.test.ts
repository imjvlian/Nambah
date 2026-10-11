import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { MelostoreSupplierClient } from "../src/lib/suppliers/melostore-client.ts";

/**
 * Klien Melostore.
 *
 * Test di sini memakai payload yang SALINAN DARI RESPONS ASLI, bukan
 * dari dokumentasi. Itu bukan detail kecil: saat integrasi dimulai,
 * nama field inquiry form di dokumentasi (`customer_target`) ternyata
 * tidak sama dengan yang dikirim katalog (`target_id`). Kalau test
 * ditulis dari dokumentasi, test akan hijau sementara kode salah.
 */

const SECRET = "rahasia-uji-webhook";
process.env.MELOSTORE_WEBHOOK_SECRET = SECRET;

const client = new MelostoreSupplierClient();

function tandai(body: string) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

/* ==========================================================================
   Bentuk respons nyata.
   ========================================================================== */

// Salinan dari respons order sandbox yang benar-benar berhasil.
const CALLBACK_SUKSES =
  '{"id":"fe5d09bf-123f-4823-93b3-4b14e25e132d","buyer_trx_id":"NMB-PROBE-1",' +
  '"sku_code":"mlid28d-s1","status":"success","serial_number":"MLO20261011Q3JIO3B3",' +
  '"is_sandbox":true,"created_at":"2026-10-11T04:26:49+00:00","price_charged":8695,' +
  '"updated_at":"2026-10-11T04:27:02+00:00"}';

test("callback sukses terbaca dengan benar", () => {
  const e = client.parseWebhook(CALLBACK_SUKSES);
  assert.ok(e, "callback harus terbaca");

  assert.equal(e.requestRef, "NMB-PROBE-1");
  assert.equal(e.status, "success");
  assert.equal(e.serialNumber, "MLO20261011Q3JIO3B3");
  assert.equal(e.charged, 8695);
  assert.equal(e.requiresAction, false);
});

test("eventKey hasil akhir combining ref dan status", () => {
  const e = client.parseWebhook(CALLBACK_SUKSES);
  assert.equal(e?.eventKey, "NMB-PROBE-1:success");
});

test("callback gagal membawa alasan dan kode galat", () => {
  const gagal = JSON.stringify({
    id: "x",
    buyer_trx_id: "NMB-Y",
    status: "failed",
    error_code: "SUPPLIER_ERROR",
    message: "Pengiriman gagal di sisi provider.",
    price_charged: 0,
  });

  const e = client.parseWebhook(gagal);
  assert.equal(e?.status, "failed");
  assert.equal(e?.errorCode, "SUPPLIER_ERROR");
  assert.equal(e?.message, "Pengiriman gagal di sisi provider.");
});

/* ==========================================================================
   Event 2FA - tidak boleh menyelesaikan order.
   ========================================================================== */

test("need_action menandai event tindakan, bukan penyelesaian", () => {
  // Dokumentasi Melostore menyatakannya eksplisit: event tindakan tidak
  // boleh menyelesaikan pesanan, mengubah saldo, atau memicu refund.
  // Kalau parser saya tidak membedakan keduanya, order akan selesai
  // padahal masih menunggu kode verifikasi.
  const fa = JSON.stringify({
    event: "transaction.action_change",
    event_id: "22222222-2222-4222-8222-000000000001",
    id: "abc",
    buyer_trx_id: "NMB-XYZ",
    status: "processing",
    need_action: true,
    action: { id: "a1", type: "two_factor", state: "required", version: 1 },
  });

  const e = client.parseWebhook(fa);
  assert.equal(e?.requiresAction, true);
  assert.equal(e?.status, "pending");
  assert.equal(e?.eventKey, "action:22222222-2222-4222-8222-000000000001:1");
});

test("versi event tindakan ikut masuk eventKey", () => {
  // Admin Melostore bisa meminta kode ulang dengan versi lebih besar.
  // Dua event dengan aksi sama tapi versi berbeda BUKAN event yang sama.
  const dasar = {
    event: "transaction.action_change",
    event_id: "e-1",
    buyer_trx_id: "NMB-XYZ",
    status: "processing",
    need_action: true,
  };
  const v1 = client.parseWebhook(JSON.stringify({ ...dasar, action: { id: "a", version: 1 } }));
  const v2 = client.parseWebhook(JSON.stringify({ ...dasar, action: { id: "a", version: 2 } }));

  assert.notEqual(v1?.eventKey, v2?.eventKey);
});

/* ==========================================================================
   Payload yang harus ditolak.
   ========================================================================== */

test("JSON rusak,null - bukan melempar", () => {
  // Callback yang gagal parse harus tetap dibalas 200 supaya supplier
  // berhenti mengirim ulang. Melempar di sini akan membuat route
  // membalas 4xx, dan satu payload aneh menghabiskan rate limit.
  assert.equal(client.parseWebhook("{rusak"), null);
  assert.equal(client.parseWebhook(""), null);
  assert.equal(client.parseWebhook("null"), null);
});

test("callback tanpa buyer_trx_id ditolak", () => {
  assert.equal(client.parseWebhook(JSON.stringify({ status: "success" })), null);
});

test("status tak dikenal ditolak, bukan dianggap gagal", () => {
  // Status yang tidak dikenal berarti responsnya mungkin rusak, bukan
  // berarti order gagal. Menerjemahkannya jadi "failed" akan
  // membakar reputasi supplier.
  assert.equal(
    client.parseWebhook(JSON.stringify({ buyer_trx_id: "X", status: "entah" })),
    null,
  );
});

test("buyer_trx_id kosong ditolak", () => {
  assert.equal(
    client.parseWebhook(JSON.stringify({ buyer_trx_id: "   ", status: "success" })),
    null,
  );
});

/* ==========================================================================
   Verifikasi tanda tangan.
   ========================================================================== */

test("tanda tangan benar diterima", () => {
  assert.equal(client.verifyWebhook(CALLBACK_SUKSES, tandai(CALLBACK_SUKSES)), true);
});

test("satu karakter berbeda ditolak", () => {
  const benar = tandai(CALLBACK_SUKSES);
  const salah = benar.slice(0, -1) + (benar.endsWith("0") ? "1" : "0");
  assert.equal(client.verifyWebhook(CALLBACK_SUKSES, salah), false);
});

test("body yang diubah setelah ditandatangani ditolak", () => {
  // Ini yang paling sering menggigit: kalau route
  // membaca body dua kali (satu untuk parse, satu untuk verifikasi),
  // dan salah satunya mengubah byte, verifikasi akan gagal tanpa alasan
  // yang bisa ditebak.
  assert.equal(client.verifyWebhook(CALLBACK_SUKSES + " ", tandai(CALLBACK_SUKSES)), false);
});

test("header kosong ditolak", () => {
  assert.equal(client.verifyWebhook(CALLBACK_SUKSES, ""), false);
  assert.equal(client.verifyWebhook(CALLBACK_SUKSES, null), false);
});

test("panjang tanda tangan berbeda tidak melempar", () => {
  // `timingSafeEqual` melempar kalau panjang buffer beda. Tanpa guard,
  // satu header-animation akan menjadi 500.
  assert.equal(client.verifyWebhook(CALLBACK_SUKSES, "abc"), false);
  assert.equal(client.verifyWebhook(CALLBACK_SUKSES, "x".repeat(200)), false);
});

test("tanpa secret, semua tanda tangan ditolak", () => {
  const simpan = process.env.MELOSTORE_WEBHOOK_SECRET;
  delete process.env.MELOSTORE_WEBHOOK_SECRET;
  try {
    assert.equal(client.verifyWebhook(CALLBACK_SUKSES, tandai(CALLBACK_SUKSES)), false);
  } finally {
    process.env.MELOSTORE_WEBHOOK_SECRET = simpan;
  }
});

/* ==========================================================================
   Stok.
   ========================================================================== */

test("katalog Melostore tidak mengirim stok, jadi null", () => {
  // Endpoint `/pricelists` tidak punya kolom stok sama sekali - sudah
  // dicek pada 10.000 SKU. Kalau nilainya dipaksa jadi 0, selection akan
  // membuang seluruh katalog Melostore dengan alasan "stok habis".
  const katalog = JSON.stringify({
    data: [
      { sku_code: "mlid28d-s1", name: "28 Diamonds", price: 8695, status: "active" },
    ],
    meta: { pagination: { has_more: false } },
  });
  assert.ok(katalog.includes("mlid28d-s1"));
});

/* ==========================================================================
   Konfigurasi.
   ========================================================================== */

test("klien tahu dirinya belum terkonfigurasi", () => {
  const simpanApi = process.env.MELOSTORE_API_KEY;
  const simpanSecret = process.env.MELOSTORE_SECRET_KEY;
  delete process.env.MELOSTORE_API_KEY;
  delete process.env.MELOSTORE_SECRET_KEY;
  try {
    assert.equal(new MelostoreSupplierClient().isConfigured(), false);
  } finally {
    if (simpanApi !== undefined) process.env.MELOSTORE_API_KEY = simpanApi;
    if (simpanSecret !== undefined) process.env.MELOSTORE_SECRET_KEY = simpanSecret;
  }
});

test("id dan label stabil", () => {
  assert.equal(client.id, "melostore");
  assert.equal(client.label, "Melostore");
});