import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAmount,
  planPaymentAllocation,
  type PayableInvoice,
} from "../src/lib/merchant-payment-rules.ts";

/**
 * Alokasi FIFO pelunasan merchant.
 *
 * Salah alokasi punya dua akibat yang sama buruk: merchant yang sudah
 * melunasi tagihan lamanya masih ditagih, atau piutang yang sebenarnya
 * belum dibayar ikut dianggap lunas. Karena itu urutan FIFO diuji dengan
 * nominal yang TEPAT sama dengan tagihan, bukan hanya angka yang jauh-jauh
 * dari batas - kasus melingkar justru yang paling sering salah.
 */

const invoice = (
  orderId: string,
  finalPrice: number,
  dueAt: string | null,
  createdAt: string,
): PayableInvoice => ({
  orderId,
  finalPrice,
  receivableDueAt: dueAt,
  createdAt,
});

test("pembayaran tepat sama dengan piutang menutup semua order", () => {
  const result = planPaymentAllocation(
    [
      invoice("A", 50_000, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
      invoice("B", 70_000, "2026-10-02T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
    ],
    120_000,
  );

  assert.equal(result.applied, 120_000);
  assert.equal(result.credit, 0);
  assert.equal(result.remaining.length, 0);
  assert.deepEqual(
    result.settled.map((s) => s.orderId),
    ["A", "B"],
  );
});

test("order yang paling lama dilunasi lebih dulu", () => {
  /*
   * Disengaja inputnya tidak terurut: B dibuat lebih dulu, tapi A punya
   * tenggat lebih awal. FIFO memakai tenggat sebagai penentu utama, jadi
   * A haruscloses lebih dulu.
   */
  const result = planPaymentAllocation(
    [
      invoice("B", 70_000, "2026-10-05T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
      invoice("A", 50_000, "2026-10-02T00:00:00.000Z", "2026-10-03T00:00:00.000Z"),
    ],
    50_000,
  );

  assert.deepEqual(result.settled, [
    { orderId: "A", applied: 50_000, partial: false },
  ]);
  assert.equal(result.applied, 50_000);
  assert.equal(result.credit, 0);
  assert.deepEqual(
    result.remaining.map((i) => i.orderId),
    ["B"],
  );
});

test("pembayaran sebagian menutup order terlama dan menandai parsial", () => {
  const result = planPaymentAllocation(
    [
      invoice("A", 50_000, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
      invoice("B", 70_000, "2026-10-02T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
    ],
    20_000,
  );

  assert.deepEqual(result.settled, [
    { orderId: "A", applied: 20_000, partial: true },
  ]);
  assert.equal(result.applied, 20_000);
  // Sisa tagihan A (Rp30.000) TIDAK hilang: order A tetap ada di `remaining`
  // supaya pembayaran berikutnya melanjutkannya, bukan melompat ke B.
  assert.deepEqual(
    result.remaining.map((i) => i.orderId),
    ["A", "B"],
  );
});

test("pembayaran melingkupi piutang menghasilkan sisa bayar, bukan error", () => {
  /*
   * Merchant boleh transfer lebih besar dari piutang yang sedang berjalan.
   * Migration 036 sengaja tidak memberi `merchant_balances.balance` CHECK >= 0
   * justru untuk keadaan ini - jadi overpayment itu sah, bukan ditolak.
   */
  const result = planPaymentAllocation(
    [invoice("A", 120_000, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")],
    150_000,
  );

  assert.equal(result.applied, 120_000);
  assert.equal(result.credit, 30_000);
  assert.equal(result.remaining.length, 0);
});

test("tanpa piutang, seluruh pembayaran jadi sisa bayar", () => {
  const result = planPaymentAllocation([], 75_000);

  assert.equal(result.applied, 0);
  assert.equal(result.credit, 75_000);
  assert.deepEqual(result.settled, []);
});

test("order tanpa tenggat tetap bisa dibayar dan diurutkan di akhir", () => {
  /*
   * Order tanpa `receivable_due_at` adalah order yang fulfillment-nya belum
   * pernah jalan. Ia PIUTANG yang nyata dan harus bisa dilunasi - hanya tidak
   * bisa dikategorikan sebagai segera/terlambat. Mengabaikannya berarti
   * transfer merchant tidak pernah terpakai.
   */
  const result = planPaymentAllocation(
    [
      invoice("TANPA-TENGGAT", 90_000, null, "2026-10-01T00:00:00.000Z"),
      invoice("BERTENGGAT", 40_000, "2026-10-02T00:00:00.000Z", "2026-10-09T00:00:00.000Z"),
    ],
    130_000,
  );

  assert.equal(result.applied, 130_000);
  assert.equal(result.credit, 0);
  // Yang bertenggat lebih dulu, walau dibuat belakangan.
  assert.deepEqual(
    result.settled.map((s) => s.orderId),
    ["BERTENGGAT", "TANPA-TENGGAT"],
  );
});

test("dua order tanpa tenggat diurutkan dari yang paling lama dibuat", () => {
  const result = planPaymentAllocation(
    [
      invoice("BARU", 10_000, null, "2026-10-09T00:00:00.000Z"),
      invoice("LAMA", 10_000, null, "2026-10-01T00:00:00.000Z"),
    ],
    10_000,
  );

  assert.deepEqual(
    result.settled.map((s) => s.orderId),
    ["LAMA"],
  );
});

test("piutang nol atau rusak tidak dianggap sudah lunas", () => {
  /*
   * Kalau `final_price` rusak dan nilainya dianggap "sudah lunas", order itu
   * hilang dari piutang tanpa jejak -ANCEL piutang yang mungkin masih nyata.
   * Jadi order bermasalah harus DILEWATI, bukan dihitung sebagai lunas.
   */
  const result = planPaymentAllocation(
    [
      invoice("NOL", 0, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
      invoice("Rusak", Number.NaN, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
      invoice("SAH", 25_000, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
    ],
    25_000,
  );

  assert.deepEqual(
    result.settled.map((s) => s.orderId),
    ["SAH"],
  );
  assert.equal(result.credit, 0);
});

test("pembayaran tidak mengubah input asli", () => {
  const invoices = [
    invoice("B", 70_000, "2026-10-05T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
    invoice("A", 50_000, "2026-10-02T00:00:00.000Z", "2026-10-03T00:00:00.000Z"),
  ];
  const snapshot = JSON.stringify(invoices);

  planPaymentAllocation(invoices, 20_000);

  // `sortByAge` menyalin sebelum mengurutkan. Kalau tidak, urutan tagihan
  // merchant berubah setiap kali admin menyimpan pelunasan - dan angka
  // "tagihan terlama" di dashboard ikut berubah-ubah.
  assert.equal(JSON.stringify(invoices), snapshot);
});

test("pembayaran lanjutan melunasi sisa order parsial, bukan melompat", () => {
  /*
   * Regresi untuk bug alokasi: order yang terpubei sebagian sempat
   * dikeluarkan dari `remaining`, sehingga pembayaran berikutnya melompat ke
   * order yang lebih baru. Akibatnya merchant ditagih ulang untuk sisa yang
   * sudah mereka bayar sebagian, dan piutang Lacte tidak pernah ikut lunas.
   *
   * Dua pembayaran Rp30.000 untuk piutang A Rp50.000 + B Rp70.000 harus
   * menutup A sepenuhnya DULU, baru menyisakan Rp20.000 untuk B.
   */
  const invoices = [
    invoice("A", 50_000, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
    invoice("B", 70_000, "2026-10-02T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
  ];

  const first = planPaymentAllocation(invoices, 30_000);
  assert.equal(first.applied, 30_000);
  assert.deepEqual(first.remaining.map((i) => i.orderId), ["A", "B"]);
  // Sisa tagihan A harus TERLIHAT dan hanya itu - bukan lagi Rp50.000.
  assert.equal(first.remaining[0].finalPrice, 20_000);

  // Pembayaran kedua memakai antrean yang sama seperti caller sebenarnya:
  // `remaining` dari langkah sebelumnya.
  const second = planPaymentAllocation(first.remaining, 30_000);
  assert.deepEqual(
    second.settled.map((s) => [s.orderId, s.applied]),
    [
      ["A", 20_000],
      ["B", 10_000],
    ],
  );
  assert.equal(second.credit, 0);
  assert.deepEqual(second.remaining.map((i) => i.orderId), ["B"]);
  assert.equal(second.remaining[0].finalPrice, 60_000);
});

test("nominal tidak positif ditolak", () => {
  assert.throws(() => normalizeAmount(0));
  assert.throws(() => normalizeAmount(-5_000));
  assert.throws(() => normalizeAmount("abc"));
  assert.throws(() => normalizeAmount(Number.NaN));
  assert.throws(() => planPaymentAllocation([], 0));
});

test("nominal pecahan dibulatkan ke rupiah penuh", () => {
  // Kolom `merchant_payments.amount` adalah bigint; koma dua akan ditolak
  // PostgREST dengan error yang tidak menjelaskan apa pun yang salah.
  assert.equal(normalizeAmount("1234.56"), 1235);
  assert.equal(normalizeAmount(70_000.4), 70_000);
  assert.equal(normalizeAmount("70000"), 70_000);
});