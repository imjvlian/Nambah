import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Fitur Midtrans "Automatic Fee Imposition" (dashboard: biaya layanan
 * 100% diterjunkan ke pembeli) menambah fee MDR DI ATAS nilai order —
 * `gross_amount` di webhook jadi >= final_price, bukan ===.
 *
 * Sumber: docs.midtrans.com/docs/snap-advanced-feature — contoh resmi:
 * QRIS Rp100.000 + MDR 0,7% → pembeli bayar Rp100.705, dan notifikasi
 * membawa `extra_info.gross_amount_info.customer_imposed_payment_fee`
 * = Rp705. Settlement ke merchant tetap Rp100.000.
 *
 * Sebelum perbaikan, invariant webhook tegas `gross_amount ===
 * final_price`, sehingga SETIAP order yang kena fee batal diproses:
 * dana masuk, order tidak pernah paid, fulfilment tidak jalan. Test ini
 * mengunci aturan baru supaya tidak dilupakan lagi.
 */

const webhook = () =>
  readFileSync("src/lib/order-service.ts", "utf8");

test("invariant lama `===` sudah dimusnahkan", () => {
  const code = webhook();

  // Bentuk lama: `Math.round(grossAmount) !== Number(order.final_price)`
  // sebagai penolakan. Sudah TIDAK boleh ada - notifikasi kena fee
  // sah dan HARUS diproses.
  assert.ok(
    !code.includes("Math.round(grossAmount) !== Number(order.final_price)"),
    "penolakan equality ketat tidak lagi ada di applyMidtransStatus",
  );
});

test("gross di bawah nilai order tetap ditolak (fail-closed)", () => {
  const code = webhook();

  assert.ok(
    code.includes("const buyerFee = Math.round(grossAmount) - finalPrice;"),
    "selisih fee dihitung eksplisit",
  );
  assert.ok(
    code.includes("if (buyerFee < 0) {"),
    "pembayaran lebih kecil dari nilai order ditolak",
  );
  assert.ok(
    code.includes("kurang dari nilai order"),
    "pesan error membedakan kurang-bayar dari fee",
  );
});

test("selisih fee disilang-cek dengan pengumuman Midtrans (anti-tamper)", () => {
  const code = webhook();

  assert.ok(
    code.includes("customer_imposed_payment_fee"),
    "cross-check dengan extra_info.gross_amount_info",
  );
  assert.ok(
    code.includes("Math.round(declaredFee) !== buyerFee"),
    "selisih yang tidak cocok dengan fee yang diumumkan ditolak",
  );
  assert.ok(
    code.includes("Fee pembeli Midtrans tidak cocok"),
    "pesan error anti-tamper spesifik",
  );
});

test("fee > 0 dicatat di log operator tanpa mengubah pembukuan", () => {
  const code = webhook();

  assert.ok(
    code.includes("[midtrans] fee diterjunkan ke pembeli"),
    "log operator saat fee dibebankan",
  );

  // Pembukuan TIDAK berubah: settlement ke merchant = final_price
  // (fee sudah dipotong dari pembeli, bukan dari settlement), jadi
  // payments.amount tetap final_price — tidak ada patungan fee di
  // sumber data finansial di repo ini.
  assert.ok(
    !code.includes("updatePayload.amount ="),
    "webhook tidak mengubah amount ke gross yang memuat fee",
  );
});

test("tipe payload Midtrans punya extra_info ber-tipe", () => {
  const client = readFileSync("src/lib/midtrans/client.ts", "utf8");

  assert.ok(
    client.includes("MidtransGrossAmountInfo"),
    "tipe gross_amount_info terdokumentasi",
  );
  assert.ok(
    client.includes("customer_imposed_payment_fee") &&
      client.includes("original_amount"),
    "field pengumuman fee dan nilai order tercantum di tipe",
  );
});
