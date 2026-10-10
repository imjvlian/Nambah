import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransactionReport,
  matchesTransaction,
  normalizeSearch,
  summarizeTransactions,
  transactionsToCsv,
  type TransactionRow,
} from "../src/lib/transaction-report-rules.ts";

/**
 * Laporan transaksi.
 *
 * Yang paling rawan salah di sini adalah definisi harga. Satu order punya
 * empat angka harga yang berbeda, dan menukarnya membuat laporan terlihat
 * masuk akal padahal salah - tidak ada error, tidak ada angka negatif yang
 * mencurigakan, hanya kesimpulan bisnis yang keliru.
 */

function row(over: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "NMB-1",
    created_at: "2026-10-02T10:00:00.000Z",
    status: "success",
    gameName: "Google Play Indonesia",
    productLabel: "Google Play Rp. 5.000",
    payment_id: "qris",
    paymentName: "QRIS",
    reference_price: 6_400,
    selling_price: 5_100,
    final_price: 5_100,
    supplier_cost: 4_247,
    nambah_profit: 853,
    promotion_discount: 0,
    affiliate_commission: 0,
    points_discount: 0,
    merchant_id: null,
    service_fee_amount: null,
    target_user_id: "user-1",
    ...over,
  };
}

test("harga katalog, jual, final, dan supplier tidak dicampur", () => {
  const report = buildTransactionReport({ rows: [row()] });

  // Keempat angka harus tetap terpisah di baris laporan.
  const item = report.rows[0];
  assert.equal(item.reference_price, 6_400);
  assert.equal(item.selling_price, 5_100);
  assert.equal(item.final_price, 5_100);
  assert.equal(item.supplier_cost, 4_247);
});

test("margin memakai nambah_profit, bukan selisih harga", () => {
  /*
   * final_price - supplier_cost = 5.100 - 4.247 = 853 di kasus ini, jadi
   * kebetulan sama. Kasus di bawah sengaja dibuat berbeda supaya test
   * menangkap kalau ada yang mengulang perhitungannya sendiri.
   */
  const report = buildTransactionReport({
    rows: [
      row({
        final_price: 10_000,
        supplier_cost: 6_000,
        // Diskon dan komisi sudah dipotong: margin sebenarnya 500.
        nambah_profit: 500,
      }),
    ],
  });

  assert.equal(report.summary.profit, 500);
  // Kalau margin dihitung ulang dari harga, hasilnya 4.000 - salah.
  assert.notEqual(report.summary.profit, 4_000);
});

test("hanya order success yang jadi pendapatan", () => {
  const report = buildTransactionReport({
    rows: [
      row({ id: "ok", status: "success" }),
      row({ id: "gagal", status: "failed" }),
      row({ id: "batal", status: "cancelled" }),
      row({ id: "proses", status: "processing" }),
    ],
  });

  assert.equal(report.summary.grossRevenue, 5_100);
  assert.equal(report.summary.count, 4);
  // Order non-success tetap terlihat lewat penghitungnya, tidak hilang diam-diam.
  assert.equal(report.summary.excludedCount, 3);
});

test("order non-success tetap muncul di daftar baris", () => {
  const report = buildTransactionReport({
    rows: [row({ id: "gagal", status: "failed" })],
  });

  // Kalau order yang gagal disembunyikan, operator mengira tidak ada
  // transaksi bermasalah sama sekali.
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].id, "gagal");
});

test("pencarian mencocokkan id, game, item, dan akun", () => {
  const sample = row();

  assert.equal(matchesTransaction(sample, "NMB-1"), true);
  assert.equal(matchesTransaction(sample, "google play"), true);
  assert.equal(matchesTransaction(sample, "USER-1"), true);
  assert.equal(matchesTransaction(sample, "tidak ada"), false);
});

test("pencarian mengabaikan huruf besar-kecil dan spasi berlebih", () => {
  assert.equal(normalizeSearch("  Google   PLAY  "), "google play");
  assert.equal(matchesTransaction(row(), "  GOOGLE   play "), true);
});

test("pencarian dengan spasi di awal dan akhir dianggap kosong", () => {
  // Spasi kosong harus berarti "tanpa filter", bukan "cocok dengan spasi".
  assert.equal(matchesTransaction(row(), "   "), true);
  assert.equal(matchesTransaction(row(), ""), true);
});

test("filter status dan metode pembayaran bekerja", () => {
  const rows = [
    row({ id: "a", status: "success", payment_id: "qris" }),
    row({ id: "b", status: "failed", payment_id: "qris" }),
    row({ id: "c", status: "success", payment_id: "va" }),
  ];

  const byStatus = buildTransactionReport({ rows, filters: { status: "success" } });
  assert.equal(byStatus.totalFiltered, 2);

  const byPayment = buildTransactionReport({
    rows,
    filters: { payment: "va" },
  });
  assert.equal(byPayment.totalFiltered, 1);
  assert.equal(byPayment.rows[0].id, "c");
});

test("filter metode memakai id, bukan nama tampilan", () => {
  /*
   * Regresi: filter dulu mencocokkan ke `paymentName`, jadi filter
   * `merchant_retail` tidak pernah cocok dengan baris yang bernama
   * "Beli di Toko Ritel" - padahal UI mengirim id. Nama tampilan bisa
   * diubah kapan saja; `payment_id` tidak.
   */
  const rows = [
    row({ id: "a", payment_id: "merchant_retail", paymentName: "Beli di Toko Ritel" }),
    row({ id: "b", payment_id: "qris", paymentName: "QRIS" }),
  ];

  const report = buildTransactionReport({
    rows,
    filters: { payment: "merchant_retail" },
  });

  assert.equal(report.totalFiltered, 1);
  assert.equal(report.rows[0].id, "a");
});

test("filter metode mengabaikan nama tampilan yang diubah", () => {
  // Nama tampilan berubah, id tetap: filter harus tetap bekerja.
  const rows = [row({ payment_id: "merchant_retail", paymentName: "Belanja" })];
  const report = buildTransactionReport({
    rows,
    filters: { payment: "merchant_retail" },
  });
  assert.equal(report.totalFiltered, 1);
});

test("ringkasan dihitung dari semua baris, bukan hanya halaman", () => {
  /*
   * Ini regresi yang mudah terjadi: kalau summary diambil dari baris yang
   * sedang ditampilkan, halaman kedua akan menampilkan total yang lebih
   * kecil - dan itu dibaca sebagai "omzet anjlok".
   */
  const rows = Array.from({ length: 120 }, (_, index) =>
    row({ id: `NMB-${index}` }),
  );

  const page1 = buildTransactionReport({ rows, offset: 0, limit: 50 });
  const page2 = buildTransactionReport({ rows, offset: 50, limit: 50 });

  assert.equal(page1.rows.length, 50);
  assert.equal(page2.rows.length, 50);
  assert.equal(page1.summary.grossRevenue, page2.summary.grossRevenue);
  assert.equal(page1.totalFiltered, 120);
  assert.equal(page2.totalFiltered, 120);
  assert.equal(page2.hasMore, true);
  assert.equal(page1.hasMore, true);
});

test("halaman terakhir menandai hasMore=false", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ id: `NMB-${i}` }));
  const page = buildTransactionReport({ rows, offset: 5, limit: 50 });

  assert.equal(page.rows.length, 5);
  assert.equal(page.hasMore, false);
});

test("offset di luar jangkauan menghasilkan halaman kosong, bukan error", () => {
  const report = buildTransactionReport({ rows: [row()], offset: 500 });
  assert.equal(report.rows.length, 0);
  assert.equal(report.totalFiltered, 1);
});

test("limit dibatasi agar tidak bisa meminta seluruh riwayat sekaligus", () => {
  const rows = Array.from({ length: 500 }, (_, i) => row({ id: `NMB-${i}` }));
  const report = buildTransactionReport({ rows, limit: 10_000 });

  assert.equal(report.limit, 200);
  assert.equal(report.rows.length, 200);
});

test("margin nol tidak menghasilkan NaN", () => {
  const report = buildTransactionReport({ rows: [] });
  assert.equal(report.summary.marginPercent, 0);
});

test("ringkasan langsung tanpa filter", () => {
  const summary = summarizeTransactions([
    row({ final_price: 10_000, supplier_cost: 7_000, nambah_profit: 3_000 }),
    row({ final_price: 20_000, supplier_cost: 12_000, nambah_profit: 8_000 }),
  ]);

  assert.equal(summary.grossRevenue, 30_000);
  assert.equal(summary.supplierCost, 19_000);
  assert.equal(summary.profit, 11_000);
  assert.equal(summary.marginPercent, 36.67);
});

test("CSV memuat kolom harga lengkap dan baris TOTAL", () => {
  const rows = [row()];
  const summary = summarizeTransactions(rows);
  const csv = transactionsToCsv(rows, summary);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  for (const column of [
    "Harga Katalog",
    "Harga Jual",
    "Harga Final",
    "Harga Supplier",
    "Margin Lacte",
  ]) {
    assert.ok(csv.includes(column), `kolom ${column} hilang`);
  }
  assert.ok(csv.includes("TOTAL"));
  assert.ok(csv.includes("4247"));
});

test("CSV mengutip nilai dengan koma dan mengescape tanda kutip", () => {
  const csv = transactionsToCsv([row({ productLabel: 'Google, "Rp" 5.000' })]);
  assert.ok(csv.includes('"Google, ""Rp"" 5.000"'));
});

test("CSV tanpa ringkasan tetap valid", () => {
  const csv = transactionsToCsv([row()]);
  assert.ok(csv.includes("Tanggal"));
  assert.ok(!csv.includes("TOTAL"));
});