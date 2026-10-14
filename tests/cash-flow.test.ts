import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashFlowReport,
  cashFlowReportToCsv,
  dayKey,
  type CashFlowOrder,
} from "../src/lib/cash-flow-rules.ts";

/**
 * Perhitungan arus kas Lacte.
 *
 * Yang diuji di sini bukan aritmetika penjumlahan - yang hampir selalu
 * benar - tapi DEFINISI. Kesalahan pada definisi arus kas tidak
 * contradicted oleh test: angkanya tetap positif, tidak ada error, dan
 * laporan yang salah akan dipercaya berbulan-bulan.
 */

const FROM = new Date("2026-10-01T00:00:00.000Z");
const TO = new Date("2026-10-03T23:59:59.999Z");

function order(over: Partial<CashFlowOrder> = {}): CashFlowOrder {
  return {
    id: "NMB-1",
    status: "success",
    payment_method_id: "qris",
    final_price: 100_000,
    supplier_cost: 80_000,
    nambah_profit: 20_000,
    promotion_discount: 0,
    affiliate_commission: 0,
    points_discount: 0,
    referral_discount: 0,
    merchant_id: null,
    service_fee_amount: null,
    merchant_payment_cost: null,
    created_at: "2026-10-02T10:00:00.000Z",
    ...over,
  };
}

test("order success menghasilkan omzet, biaya, dan margin", () => {
  const report = buildCashFlowReport({ orders: [order()], from: FROM, to: TO });

  assert.equal(report.totals.orders, 1);
  assert.equal(report.totals.grossRevenue, 100_000);
  assert.equal(report.totals.supplierCost, 80_000);
  assert.equal(report.totals.grossProfit, 20_000);
  assert.equal(report.totals.marginPercent, 20);
});

test("order gagal tidak dihitung sebagai pendapatan", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ status: "failed", id: "NMB-gagal" }),
      order({ id: "NMB-ok" }),
    ],
    from: FROM,
    to: TO,
  });

  // Order failed tetap dihitung sebagaiorder gagal supaya operator tahu
  // ada masalah, tapi TIDAK menambah omzet - uangnya tidak pernah masuk.
  assert.equal(report.totals.orders, 1);
  assert.equal(report.totals.grossRevenue, 100_000);
  assert.equal(report.totals.failedOrders, 1);
});

test("order cancelled tidak masuk omzet maupun order gagal", () => {
  const report = buildCashFlowReport({
    orders: [order({ status: "cancelled" })],
    from: FROM,
    to: TO,
  });

  // Cancelled bukan kegagalan supplier - user batal sebelum bayar.
  // Menghitungnya sebagai "gagal" akan membuat angka kegagalan terlihat
  // lebih buruk dari kenyataan.
  assert.equal(report.totals.orders, 0);
  assert.equal(report.totals.failedOrders, 0);
});

test("di luar periode tidak dihitung", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ id: "sebelum", created_at: "2026-09-30T23:00:00.000Z" }),
      order({ id: "sesudah", created_at: "2026-10-04T01:00:00.000Z" }),
      order({ id: "dalam", created_at: "2026-10-02T10:00:00.000Z" }),
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.orders, 1);
});

test("biaya layanan merchant bukan pendapatan Lacte", () => {
  /*
   * Biaya layanan dibayar user LANGSUNG ke merchant. Uangnya tidak pernah
   * melewati Lacte. Kalau ikut dijumlahkan sebagai omzet, margin akan
   * terlihat jauh lebih sehat dari kenyataan - dan ini justru kesalahan
   * yang sama seperti di modul lain.
   */
  const report = buildCashFlowReport({
    orders: [
      order({
        merchant_id: "m-1",
        service_fee_amount: 5_000,
        final_price: 100_000,
        nambah_profit: 0,
      }),
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.merchantServiceFee, 5_000);
  // Margin tetap 0 - Lacte tidak mengambil apa pun dari fee merchant.
  assert.equal(report.totals.grossProfit, 0);
  assert.equal(report.totals.marginPercent, 0);
});

/**
 * Order ritel dan arus kas.
 *
 * Uang dari order ritel dibayar user ke merchant DI TOKONYA. Uang itu
 * tidak pernah melewati Lacte saat checkout - Lacte cuma mencatat
 * piutang, dan baru menerima uang ketika merchant mentransfer lewat
 * `merchant_payments`.
 *
 * Jadi order ritel bukan kas masuk. Menghitungnya sebagai omzet berarti
 * menyatakan uang yang belum bergerak sebagai yang sudah masuk, dan
 * membuat Lacte terlihat untung pada periode ketika piutangnya justru
 * bertambah.
 */

test("order ritel TIDAK masuk ke omzet kas masuk", () => {
  const report = buildCashFlowReport({
    orders: [order({ merchant_id: "m-1", final_price: 100_000, nambah_profit: 20_000 })],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.grossRevenue, 0);
  assert.equal(report.totals.grossProfit, 0);
  assert.equal(report.totals.marginPercent, 0);
  // Tapi modal dan piutang tetap tercatat.
  assert.equal(report.totals.supplierCost, 80_000);
  assert.equal(report.totals.merchantReceivable, 100_000);
  assert.equal(report.totals.merchantOrders, 1);
});

test("grafik harian ikut aturan yang sama dengan total", () => {
  /*
   * Kalau harian masih menjumlahkan order ritel, jumlah batanganya
   * tidak akan sama dengan kartu omzet - dua laporan yang berbeda di
   * halaman yang sama.
   */
  const report = buildCashFlowReport({
    orders: [order({ merchant_id: "m-1", final_price: 100_000 })],
    from: FROM,
    to: TO,
  });

  const dayTotal = report.days.reduce((sum, day) => sum + day.grossRevenue, 0);
  assert.equal(dayTotal, report.totals.grossRevenue);
  assert.equal(dayTotal, 0);
});

test("rekap per metode tidak menghitung omzet untuk metode ritel", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ id: "A", merchant_id: "m-1", payment_method_id: "merchant_retail" }),
      order({ id: "B", merchant_id: null, payment_method_id: "qris" }),
    ],
    from: FROM,
    to: TO,
  });

  const ritel = report.byMethod.find((m) => m.paymentMethodId === "merchant_retail");
  const qris = report.byMethod.find((m) => m.paymentMethodId === "qris");

  assert.equal(ritel?.orders, 1);
  assert.equal(ritel?.revenue, 0);
  assert.equal(qris?.revenue, 100_000);

  // Jumlah omzet per metode harus sama dengan omzet total.
  const methodSum = report.byMethod.reduce((sum, m) => sum + m.revenue, 0);
  assert.equal(methodSum, report.totals.grossRevenue);
});

test("campuran ritel dan non-retail: hanya non-retil yang jadi omzet", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ id: "A", merchant_id: "m-1", final_price: 7_100, supplier_cost: 4_247, nambah_profit: 853 }),
      order({ id: "B", merchant_id: null, final_price: 5_100, supplier_cost: 4_247, nambah_profit: 853 }),
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.grossRevenue, 5_100);
  assert.equal(report.totals.orders, 1);
  // Modal dari KEDUA order: barang keduanya benar-benar dikirim.
  assert.equal(report.totals.supplierCost, 8_494);
  assert.equal(report.totals.merchantReceivable, 7_100);
});

test("omzet order merchant dicatat sebagai piutang, bukan kas masuk", () => {
  const report = buildCashFlowReport({
    orders: [order({ merchant_id: "m-1" })],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.merchantOrders, 1);
  assert.equal(report.totals.merchantReceivable, 100_000);
  // Belum ada transfer merchant, jadi belum ada kas masuk dari ritel.
  assert.equal(report.totals.merchantSettled, 0);
  assert.equal(report.totals.merchantOutstanding, 100_000);
});

test("transfer merchant menjadi kas masuk dan mengurangi piutang", () => {
  const report = buildCashFlowReport({
    orders: [order({ merchant_id: "m-1", final_price: 100_000 })],
    merchantPayments: [
      { merchant_id: "m-1", amount: 120_000, created_at: "2026-10-03T09:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.merchantSettled, 120_000);
  // Kelebihan bayar jadi saldo negatif (kredit), bukan piutang positif.
  assert.equal(report.totals.merchantOutstanding, -20_000);
});

test("hari tanpa transaksi tetap muncul dengan nilai nol", () => {
  /*
   * Grafik yang hanya memuat hari bertransaksi membuat hari yang sepi
   * terlihat normal. Isi hari kosong membuat operator bisa melihat kapan
   * benar-benar tidak ada penjualan.
   */
  const report = buildCashFlowReport({
    orders: [order({ created_at: "2026-10-02T10:00:00.000Z" })],
    from: FROM,
    to: TO,
  });

  assert.equal(report.days.length, 3);
  assert.deepEqual(
    report.days.map((day) => day.date),
    ["2026-10-01", "2026-10-02", "2026-10-03"],
  );
  assert.equal(report.days[0].orders, 0);
  assert.equal(report.days[1].orders, 1);
  assert.equal(report.days[2].orders, 0);
});

test("transfer merchant masuk ke titik hari yang tepat", () => {
  const report = buildCashFlowReport({
    orders: [order({ created_at: "2026-10-02T10:00:00.000Z" })],
    merchantPayments: [
      { merchant_id: "m-1", amount: 50_000, created_at: "2026-10-03T08:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  const day3 = report.days.find((day) => day.date === "2026-10-03");
  assert.equal(day3?.merchantSettled, 50_000);
  const day2 = report.days.find((day) => day.date === "2026-10-02");
  assert.equal(day2?.merchantSettled, 0);
});

test("ringkasan per metode pembayaran", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ id: "a", payment_method_id: "qris", final_price: 100_000 }),
      order({ id: "b", payment_method_id: "qris", final_price: 50_000 }),
      order({ id: "c", payment_method_id: "va", final_price: 70_000 }),
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.byMethod.length, 2);
  // Diurutkan dari omzet terbesar.
  assert.equal(report.byMethod[0].paymentMethodId, "qris");
  assert.equal(report.byMethod[0].orders, 2);
  assert.equal(report.byMethod[0].revenue, 150_000);
  assert.equal(report.byMethod[1].paymentMethodId, "va");
});

test("diskon dan komisi dicatat terpisah dari margin", () => {
  const report = buildCashFlowReport({
    orders: [
      order({
        promotion_discount: 10_000,
        points_discount: 5_000,
        referral_discount: 2_000,
        affiliate_commission: 3_000,
      }),
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.discounts, 17_000);
  assert.equal(report.totals.affiliateCommission, 3_000);
});

test("margin nol tidak menghasilkan NaN", () => {
  const report = buildCashFlowReport({ orders: [], from: FROM, to: TO });
  assert.equal(report.totals.marginPercent, 0);
  assert.equal(report.totals.grossRevenue, 0);
});

/* ==========================================================================
   Pencairan komisi afiliasi - uang keluar nyata.
   ========================================================================== */

test("pencairan LUNAS tercatat sebagai uang keluar di hari paid_at", () => {
  const report = buildCashFlowReport({
    orders: [order()],
    affiliateWithdrawals: [
      { id: 1, amount: 50_000, paid_at: "2026-10-02T14:00:00.000Z" },
      { id: 2, amount: 30_000, paid_at: "2026-10-03T09:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.affiliatePaidOut, 80_000);
  assert.equal(report.totals.affiliatePaidCount, 2);
  // Bucket harian mengikuti paid_at, bukan tanggal request.
  const hari2 = report.days.find((d) => d.date === "2026-10-02");
  const hari3 = report.days.find((d) => d.date === "2026-10-03");
  assert.equal(hari2?.affiliatePaidOut, 50_000);
  assert.equal(hari3?.affiliatePaidOut, 30_000);
});

test("pencairan di luar rentang tidak tercatat", () => {
  const report = buildCashFlowReport({
    orders: [],
    affiliateWithdrawals: [
      { id: 1, amount: 50_000, paid_at: "2026-09-15T14:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.affiliatePaidOut, 0);
  assert.equal(report.totals.affiliatePaidCount, 0);
});

test("kolom omzet tidak tersentuh oleh pencairan", () => {
  // Pencairan adalah uang keluar, bukan pengurang omzet: komisinya
  // sudah tercatat di affiliateCommission saat order sukses.
  const report = buildCashFlowReport({
    orders: [order()],
    affiliateWithdrawals: [
      { id: 1, amount: 50_000, paid_at: "2026-10-02T14:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.grossRevenue, 100_000);
  assert.equal(report.totals.grossProfit, 20_000);
});

test("CSV memuat kolom Pencairan Afiliasi di harian dan total", () => {
  const report = buildCashFlowReport({
    orders: [order()],
    affiliateWithdrawals: [
      { id: 1, amount: 50_000, paid_at: "2026-10-02T14:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  const csv = cashFlowReportToCsv(report);
  assert.ok(csv.includes("Pencairan Afiliasi"));
  // Baris harian 2026-10-02 membawa 50000 di kolom terakhir.
  assert.ok(/2026-10-02,1,100000,80000,20000,0,50000/.test(csv));
  // Baris TOTAL berlabel juga membawanya.
  assert.ok(/TOTAL,1,100000,80000,20000,0,50000/.test(csv));
});

test("order tanpa metode pembayaran tidak membuat crash", () => {
  const report = buildCashFlowReport({
    orders: [order({ payment_method_id: null })],
    from: FROM,
    to: TO,
  });

  assert.equal(report.byMethod[0].paymentMethodId, "unknown");
});

test("tanggal tidak valid diabaikan, bukan membuat error", () => {
  const report = buildCashFlowReport({
    orders: [order({ created_at: "bukan tanggal" })],
    from: FROM,
    to: TO,
  });

  // Ordernya tidak masuk periode, tapi hari kosong tetap terbentuk.
  assert.equal(report.totals.orders, 0);
  assert.equal(report.days.length, 3);
});

test("dayKey memakai UTC agar grafik tidak bergeser", () => {
  assert.equal(dayKey("2026-10-02T23:59:59.999Z"), "2026-10-02");
  assert.equal(dayKey("2026-10-03T00:00:00.000Z"), "2026-10-03");
  assert.equal(dayKey("rusak"), null);
});

test("CSV punya BOM dan angka tanpa pemisah ribuan", () => {
  const report = buildCashFlowReport({
    orders: [order({ final_price: 1_234_567 })],
    from: FROM,
    to: TO,
  });
  const csv = cashFlowReportToCsv(report);

  // BOM: tanpa itu Excel di Windows salah baca dan beraksen jadi kisut.
  assert.equal(csv.charCodeAt(0), 0xfeff);
  // Angka harus bisa dijumlahkan Excel, jadi TANPA titik pemisah ribuan.
  assert.ok(csv.includes("1234567"));
  assert.ok(!csv.includes("1.234.567"));
  assert.ok(csv.includes("TOTAL"));
});

test("CSV mengutip nilai yang mengandung koma", () => {
  const report = buildCashFlowReport({
    orders: [order({ payment_method_id: "a,b" })],
    from: FROM,
    to: TO,
  });
  const csv = cashFlowReportToCsv(report);
  assert.ok(csv.includes('"a,b"'));
});

/* ==========================================================================
   Piutang ritel dan biaya layanan toko.

   `final_price` sudah memuat `merchantServiceFee`, dan fee itu dibayar
   pengguna LANGSUNG ke merchant - tidak pernah melewati Lacte. Jadi fee
   bukan piutang Lacte. Memakainya sebagai piutang membuat merchant
   ditagih biaya layanan tokonya sendiri.
   ========================================================================== */

test("piutang ritel dikurangi biaya layanan toko", () => {
  const report = buildCashFlowReport({
    orders: [
      order({
        merchant_id: "m-1",
        final_price: 7_100,
        service_fee_amount: 2_000,
        nambah_profit: 853,
      }),
    ],
    from: FROM,
    to: TO,
  });

  // 7.100 - 2.000, bukan 7.100.
  assert.equal(report.totals.merchantReceivable, 5_100);
  // Fee tetap dilacak supaya bisa dicocokkan dengan yang diteruskan.
  assert.equal(report.totals.merchantServiceFee, 2_000);
});

test("order ritel tanpa fee tidak berubah", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ merchant_id: "m-1", final_price: 5_100, service_fee_amount: 0 }),
    ],
    from: FROM,
    to: TO,
  });

  assert.equal(report.totals.merchantReceivable, 5_100);
});

/* ==========================================================================
   Catatan kas harian: masuk dari mana, keluar untuk apa.
   ========================================================================== */

test("kas harian: masuk hanya dari pembayaran langsung + pelunasan ritel", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ id: "biasa", final_price: 100_000, supplier_cost: 80_000 }),
      // Order ritel TIDAK boleh dihitung sebagai kas masuk: uangnya
      // dibayar di toko dan baru masuk lewat pelunasan.
      order({
        id: "ritel",
        merchant_id: "m-1",
        final_price: 50_000,
        service_fee_amount: 5_000,
        supplier_cost: 40_000,
        created_at: "2026-10-02T11:00:00.000Z",
      }),
    ],
    merchantPayments: [
      { merchant_id: "m-1", amount: 50_000, created_at: "2026-10-02T12:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  const day = report.days.find((d) => d.date === "2026-10-02");
  // 100.000 pembayaran langsung + 50.000 pelunasan ritel.
  assert.equal(day?.cashIn, 150_000);
  // Modal kedua order keluar di hari yang sama: 80.000 + 40.000.
  assert.equal(day?.cashOut, 120_000);
  assert.equal(day?.netCash, 30_000);
});

test("kas harian: pencairan afiliasi keluar di hari paid_at", () => {
  const report = buildCashFlowReport({
    orders: [order({ final_price: 100_000, supplier_cost: 80_000 })],
    affiliateWithdrawals: [
      { id: 1, amount: 30_000, paid_at: "2026-10-02T14:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  const day = report.days.find((d) => d.date === "2026-10-02");
  assert.equal(day?.cashOut, 80_000 + 30_000);
  assert.equal(day?.cashIn, 100_000);
  assert.equal(day?.netCash, -10_000);
});

test("fee gateway dihitung sebagai uang keluar", () => {
  const report = buildCashFlowReport({
    orders: [
      order({
        final_price: 100_000,
        supplier_cost: 80_000,
        merchant_payment_cost: 3_000,
      }),
    ],
    from: FROM,
    to: TO,
  });

  const day = report.days.find((d) => d.date === "2026-10-02");
  assert.equal(day?.gatewayFee, 3_000);
  assert.equal(day?.cashOut, 83_000);
});

test("biaya layanan toko tidak masuk sebagai kas masuk maupun keluar", () => {
  const report = buildCashFlowReport({
    orders: [
      order({
        merchant_id: "m-1",
        final_price: 43_100,
        service_fee_amount: 3_000,
        supplier_cost: 32_600,
      }),
    ],
    merchantPayments: [
      { merchant_id: "m-1", amount: 40_100, created_at: "2026-10-02T12:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  const day = report.days.find((d) => d.date === "2026-10-02");
  // Pelunasan yang dicatat 40.100 (tanpa fee) adalah satu-satunya kas masuk.
  assert.equal(day?.cashIn, 40_100);
  // Fee 3.000 tidak boleh muncul sebagai kas keluar - uangnya bukan milik Lacte.
  assert.equal(day?.cashOut, 32_600);
  assert.equal(day?.netCash, 7_500);
});

test("hari tanpa transaksi tetap punya kas masuk dan keluar nol", () => {
  const report = buildCashFlowReport({ orders: [], from: FROM, to: TO });

  for (const day of report.days) {
    assert.equal(day.cashIn, 0);
    assert.equal(day.cashOut, 0);
    assert.equal(day.netCash, 0);
  }
});

test("total kas sama dengan penjumlahan baris harian", () => {
  const report = buildCashFlowReport({
    orders: [
      order({ id: "a", created_at: "2026-10-01T08:00:00.000Z", final_price: 100_000, supplier_cost: 80_000, merchant_payment_cost: 1_000 }),
      order({ id: "b", created_at: "2026-10-03T08:00:00.000Z", final_price: 60_000, supplier_cost: 50_000 }),
    ],
    merchantPayments: [
      { merchant_id: "m-1", amount: 25_000, created_at: "2026-10-02T10:00:00.000Z" },
    ],
    affiliateWithdrawals: [
      { id: 1, amount: 10_000, paid_at: "2026-10-02T10:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  const dayIn = report.days.reduce((sum, day) => sum + day.cashIn, 0);
  const dayOut = report.days.reduce((sum, day) => sum + day.cashOut, 0);
  const dayNet = report.days.reduce((sum, day) => sum + day.netCash, 0);

  // Kolom TOTAL harus bisa direkonsiliasi dengan menjumlahkan tabelnya.
  // Kalau tidak, kartu TOTAL dan penjumlahan kolom akan berbeda.
  assert.equal(report.totals.cashIn, dayIn);
  assert.equal(report.totals.cashOut, dayOut);
  assert.equal(report.totals.netCash, dayNet);
  assert.equal(report.totals.cashIn, 160_000 + 25_000);
  assert.equal(report.totals.cashOut, 130_000 + 10_000 + 1_000);
});

test("bucket harian tetap mencatat hari yang sama walau transaksi berurutan", () => {
  /*
   * Regresi untuk bug bucket: kalau bucket baru dibuat dengan menyalin
   * objek dan `days.set` tidak dipanggil untuk hari yang sudah ada,
   * penambahan kedua pada hari yang sama akan hilang.
   */
  const report = buildCashFlowReport({
    orders: [
      order({ id: "a", created_at: "2026-10-02T08:00:00.000Z", final_price: 10_000 }),
      order({ id: "b", created_at: "2026-10-02T09:00:00.000Z", final_price: 20_000 }),
      order({ id: "c", created_at: "2026-10-02T10:00:00.000Z", final_price: 30_000 }),
    ],
    merchantPayments: [
      { merchant_id: "m-1", amount: 5_000, created_at: "2026-10-02T11:00:00.000Z" },
    ],
    from: FROM,
    to: TO,
  });

  const day = report.days.find((d) => d.date === "2026-10-02");
  assert.equal(day?.orders, 3);
  assert.equal(day?.grossRevenue, 60_000);
  assert.equal(day?.merchantSettled, 5_000);
  assert.equal(day?.cashIn, 65_000);
});

test("CSV harian memuat kolom masuk, keluar, dan selisih", () => {
  const report = buildCashFlowReport({
    orders: [
      order({
        final_price: 100_000,
        supplier_cost: 80_000,
        merchant_payment_cost: 2_000,
      }),
    ],
    from: FROM,
    to: TO,
  });

  const csv = cashFlowReportToCsv(report);
  assert.ok(csv.includes("Uang Masuk"));
  assert.ok(csv.includes("Uang Keluar"));
  assert.ok(csv.includes("Selisih"));
  assert.ok(csv.includes("Fee Gateway"));
  // 100.000 masuk; 80.000 + 2.000 keluar; sisih 18.000.
  assert.ok(/2026-10-02,1,100000,80000,20000,0,0,2000,100000,82000,18000/.test(csv));
  assert.ok(/TOTAL,1,100000,80000,20000,0,0,2000,100000,82000,18000/.test(csv));
});