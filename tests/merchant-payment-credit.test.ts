import assert from "node:assert/strict";
import test from "node:test";

import {
  planPaymentAllocation,
  type PayableInvoice,
} from "../src/lib/merchant-payment-rules.ts";

/**
 * Kredit yang hilang adalah kegagalan yang paling mahal di modul pelunasan.
 *
 * Bug nyata yang ditemukan saat pengujian: `syncMerchantBalance` menghitung
 * `balance` dari order saja, sementara `recordMerchantPayment` menulis kredit
 * terpisah. Sync berjalan SESUDAH penulisan, jadi menimpanya - Rp91.800
 * kelebihan bayar lenyap tanpa error apa pun.
 *
 * Tes di bawah mengunci PERILAKU yang harusnya benar, supaya perbaikan
 * `getUnappliedPaymentCredit` tidak bisa dibatalkan diam-diam nanti.
 */

/** Piutang berjalan yang sama seperti di database saat bug ditemukan. */
const RUNNING: PayableInvoice[] = [
  {
    orderId: "A",
    finalPrice: 5_100,
    receivableDueAt: "2026-10-17T01:15:39.732Z",
    createdAt: "2026-10-10T01:15:39.732Z",
  },
  {
    orderId: "B",
    finalPrice: 7_100,
    receivableDueAt: null,
    createdAt: "2026-10-10T02:00:00.000Z",
  },
  {
    orderId: "C",
    finalPrice: 7_100,
    receivableDueAt: null,
    createdAt: "2026-10-10T03:00:00.000Z",
  },
  {
    orderId: "D",
    finalPrice: 7_100,
    receivableDueAt: null,
    createdAt: "2026-10-10T04:00:00.000Z",
  },
];

const TOTAL = 26_400;

/**
 * Simulasikan rangkaian panggilan `recordMerchantPayment` terhadap database.
 *
 * YANG PENTING: simulasi ini meniru apa yang BENAR-BENAR ditulis ke
 * database, bukan apa yang "seharusnya" terjadi.
 *
 * Order parsial TIDAK PERNAH ditandai lunas - `recordMerchantPayment`
 * sengaja melewati `entry.partial`. Jadi `final_price` order parsial tetap
 * utuh di database dan `receivable_paid_at`-nya masih null. Uang yang sudah
 * dibayar untuk bagian parsial tersimpan di `merchant_balances` sebagai nilai
 * negatif, bukan dengan memotong tagihan order.
 *
 * Mengira tagihan order ikut terpotong - padahal `plan.remaining` hanya
 * melaporkan sisa untuk keperluan alokasi langkah berikutnya, bukan state
 * database - akan menghasilkan angka yang berbeda dari produksi, dan test ini
 * justru akan mengunci perhitungan yang salah.
 */
function simulate(payments: Array<{ amount: number; settle: boolean }>) {
  const settledIds = new Set<string>();
  let received = 0;

  for (const payment of payments) {
    if (!payment.settle) continue;
    received += payment.amount;

    const open = RUNNING.filter((invoice) => !settledIds.has(invoice.orderId));
    const plan = planPaymentAllocation(open, payment.amount);

    for (const entry of plan.settled) {
      if (!entry.partial) settledIds.add(entry.orderId);
    }
  }

  // Rumus yang sama persis dengan `getUnappliedPaymentCredit`.
  const outstanding = RUNNING.filter((i) => !settledIds.has(i.orderId)).reduce(
    (sum, i) => sum + i.finalPrice,
    0,
  );
  const consumed = RUNNING.filter((i) => settledIds.has(i.orderId)).reduce(
    (sum, i) => sum + i.finalPrice,
    0,
  );
  const credit = received - consumed;

  return {
    outstanding,
    credit,
    settledTotal: consumed,
    balance: outstanding - credit,
  };
}

test("kelebihan bayar bertahan setelah sync dijalankan ulang", () => {
  // Satu transfer Rp100.000 untuk seluruh piutang Rp26.400: semua order
  // lunas dan sisanya jadi kredit.
  const state = simulate([{ amount: 100_000, settle: true }]);

  assert.equal(state.settledTotal, TOTAL);
  assert.equal(state.credit, 100_000 - TOTAL);
  assert.equal(state.outstanding, 0);

  // Inilah yang harusnya tersimpan. Kalau nilai ini 0, kredit lenyap -
  // persis bug yang ditemukan.
  assert.equal(state.balance, -(100_000 - TOTAL));
});

test("kredit langsung mengurangi piutang berikutnya", () => {
  // Transfer pertama Rp13.200 (lunas sebagian: satu order penuh + satu
  // parsial), lalu transfer Rp100.000 untuk sisa piutang Rp14.200.
  const state = simulate([
    { amount: 13_200, settle: true },
    { amount: 100_000, settle: true },
  ]);

  // Seluruh piutang Rp26.400 akhirnya lunas, dan total yang diterima
  // Rp113.200 - Rp26.400 = Rp86.800 menjadi kredit merchant.
  assert.equal(state.settledTotal, TOTAL);
  assert.equal(state.outstanding, 0);
  assert.equal(state.credit, 86_800);
  assert.equal(state.balance, -86_800);
});

test("pembayaran yang menyisakan tagihan tidak menghasilkan kredit", () => {
  // Membayar Rp13.200 dari piutang Rp26.400: A dan B lunas, C terpubei
  // Rp1.000 dan sisanya Rp6.100 masih tertagih.
  //
  // Kredit Rp1.000 itu BENAR, bukan bug: uang Rp1.000 sudah diterima Lacte
  // dan tidak lagi tercermin di tagihan order manapun karena order C belum
  // ditandai lunas. Kalau kredit ini diabaikan, merchant ditagih Rp26.400
  // padahal sudah mengirim Rp13.200.
  const state = simulate([{ amount: 13_200, settle: true }]);

  assert.equal(state.settledTotal, 12_200);
  assert.equal(state.outstanding, TOTAL - 12_200);
  assert.equal(state.credit, 1_000);
  // 14.200 - 1.000 = 13.200: sisa yang benar-benar masih terutang.
  assert.equal(state.balance, 13_200);
});

test("pembayaran tepat sama sekali tidak menghasilkan kredit", () => {
  const state = simulate([{ amount: TOTAL, settle: true }]);

  assert.equal(state.credit, 0);
  assert.equal(state.outstanding, 0);
  assert.equal(state.balance, 0);
  assert.equal(state.settledTotal, TOTAL);
});

test("piutang berjalan nol tapi ada sisa bayar, balance tetap negatif", () => {
  // Kasus yang paling mudah salah: `getOutstandingReceivable` mengembalikan
  // 0, jadi implementasi lama akan menyimpan balance = 0 dan kehilangan
  // seluruh sisa bayar merchant.
  const state = simulate([{ amount: 200_000, settle: true }]);

  assert.equal(state.outstanding, 0);
  assert.equal(state.credit, 200_000 - TOTAL);
  assert.ok(state.balance < 0, "balance harus negatif, bukan 0");
});