/**
 * Perhitungan arus kas — bagian MURNI, tanpa I/O.
 *
 * File ini terpisah dari `cash-flow.ts` karena modul latter mengimpor
 * `server-only` dan Supabase. Defisi "uang masuk" dan "keluar" adalah
 * keputusan bisnis yang paling mudah salah, jadi satu-satunya cara
 * mengujinya adalah memuat kodenya tanpa menarik database ikut-ikutan.
 *
 * ATURAN YANG MENGIKAT SELURUH LAPISAN DI BAWAH INI
 *
 * 1. Omzet (`grossRevenue`) memakai `final_price` - harga yang benar-benar
 *    dibayar user. Bukan `selling_price`, karena sudah dikurangi diskon, dan
 *    bukan `reference_price`, karena itu harga katalog sebelum segalanya.
 *
 * 2. Biaya supplier memakai `supplier_cost`, TIDAK `merchant_payment_cost`.
 *    Order merchant dibayar user ke merchant, jadi `merchant_payment_cost`
 *    selalu 0 - memakai kolom itu akan membuat biaya supplier terlihat
 *    gratis untuk semua transaksi ritel.
 *
 * 3. Biaya layanan merchant TIDAK boleh masuk sebagai "pendapatan Lacte".
 *    Uang itu dibayar user langsung ke merchant dan tidak pernah melewati
 *    Lacte. Menghitungnya sebagai pendapatan akan membuat margin terlihat
 *    jauh lebih besar dari kenyataan - dan kesalahan seperti ini justru
 *    pernah terjadi di bagian lain sistem ini, jadi harus dihindari dari
 *    awal.
 *
 * 4. Order merchant menghasilkan PIUTANG, bukan arus kas masuk. Uang baru
 *    masuk Lacte saat merchant transfer dan dicatat di `merchant_payments`.
 *    Menghitungnya sebagai "tunai masuk" akan menganggap piutang sebagai uang
 *    yang sudah diterima.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Status order yang menghasilkan uang benar-benar diterima Lacte. */
export const REVENUE_STATUSES = new Set(["success"]);

export type CashFlowOrder = {
  id: string;
  status: string;
  payment_method_id: string | null;
  /** Harga akhir yang dibayar user. */
  final_price: number | string;
  /** Modal yang keluar untuk fulfill order ini. */
  supplier_cost: number | string;
  /** Margin Lacte - sudah dipotong promo, poin, dan komisi. */
  nambah_profit: number | string;
  promotion_discount: number | string;
  affiliate_commission: number | string;
  points_discount: number | string;
  referral_discount: number | string;
  merchant_id: string | null;
  service_fee_amount: number | string | null;
  created_at: string;
};

export type CashFlowPayment = {
  order_id: string | null;
  amount: number | string;
  status: string;
  provider: string | null;
  paid_at: string | null;
};

export type MerchantPaymentRow = {
  merchant_id: string;
  amount: number | string;
  created_at: string;
};

/** Satu titik harian pada grafik. */
export type CashFlowDay = {
  /** `YYYY-MM-DD` dalam UTC. */
  date: string;
  /** Pesanan selesai (success) pada hari itu. */
  orders: number;
  /** Omzet dari order success. */
  grossRevenue: number;
  /** Biaya supplier untuk order success itu. */
  supplierCost: number;
  /** Margin Lacte untuk order success itu. */
  profit: number;
  /** Uang masuk dari transfer merchant pada hari itu. */
  merchantSettled: number;
};

export type CashFlowTotals = {
  /** Order NON-merchant yang selesai. Order ritel tidak dihitung di sini. */
  orders: number;
  /**
   * Omzet yang benar-benar masuk lewat pembayaran langsung.
   *
   * Order merchant TIDAK ikut di sini. Uang dari order ritel dibayar ke
   * merchant di tokonya, tidak pernah masuk ke Lacte saat checkout - Lacte
   * hanya mencatat piutang, dan baru menerima uang ketika merchant
   * mentransfer lewat `merchant_payments`.
   *
   * Menghitungnya sebagai kas masuk akan menyatakan uang yang belum
   * bergerak sebagai yang sudah masuk.
   */
  grossRevenue: number;
  supplierCost: number;
  grossProfit: number;
  marginPercent: number;
  /** Total biaya yang dikurangi dari omzet. */
  discounts: number;
  affiliateCommission: number;
  /**
   * Biaya layanan yang dibayar user ke merchant.
   *
   * Tidak milik Lacte dan tidak masuk omzet. Tetap dilacak supaya fee
   * yang dipotong dari piutang bisa dicocokkan dengan yang diteruskan.
   */
  merchantServiceFee: number;
  /** Jumlah order dari jalur merchant ritel. */
  merchantOrders: number;
  /** Omzet order merchant - jadi piutang, bukan kas masuk. */
  merchantReceivable: number;
  /** Uang yang benar-benar diterima dari transfer merchant. */
  merchantSettled: number;
  /** Sisa piutang merchant yang belum dibayar. */
  merchantOutstanding: number;
  failedOrders: number;
};

export type CashFlowByMethod = {
  paymentMethodId: string;
  orders: number;
  revenue: number;
  supplierCost: number;
  profit: number;
};

export type CashFlowReport = {
  from: string;
  to: string;
  days: CashFlowDay[];
  totals: CashFlowTotals;
  byMethod: CashFlowByMethod[];
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Kunci hari UTC. UTC dipilih supaya grafik tidak bergeser antar zona waktu server. */
export function dayKey(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Bangun laporan arus kas.
 *
 * `orders` yang sudah success determines revenue; `payments` hanya dipakai
 * sebagai pembanding dan tidak boleh menjumlahkan dua kali - kalau
 * `final_price` order dan `amount` payment dijumlahkan bersamaan, setiap
 * transaksi akan terhitung dua kali.
 *
 * `merchantPayments` dipakai untuk arus kas masuk yang SEBENARNYA terjadi:
 * transfer merchant. Order merchant sendiri tidak masuk ke `grossRevenue`
 * sebagai kas masuk.
 */
export function buildCashFlowReport(input: {
  orders: CashFlowOrder[];
  merchantPayments?: MerchantPaymentRow[];
  from: Date;
  to: Date;
  now?: number;
}): CashFlowReport {
  const { orders, merchantPayments = [], from, to } = input;
  const fromMs = from.getTime();
  const toMs = to.getTime();

  const days = new Map<string, CashFlowDay>();
  const methodTotals = new Map<string, CashFlowByMethod>();

  const totals: CashFlowTotals = {
    orders: 0,
    grossRevenue: 0,
    supplierCost: 0,
    grossProfit: 0,
    marginPercent: 0,
    discounts: 0,
    affiliateCommission: 0,
    merchantServiceFee: 0,
    merchantOrders: 0,
    merchantReceivable: 0,
    merchantSettled: 0,
    merchantOutstanding: 0,
    failedOrders: 0,
  };

  const withinRange = (iso: string | null) => {
    if (!iso) return false;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
  };

  for (const order of orders) {
    if (!withinRange(order.created_at)) continue;

    if (!REVENUE_STATUSES.has(order.status)) {
      if (order.status === "failed") totals.failedOrders += 1;
      continue;
    }

    const revenue = num(order.final_price);
    const supplierCost = num(order.supplier_cost);
    const profit = num(order.nambah_profit);
    const isMerchant = Boolean(order.merchant_id);

    /*
 * Modal supplier dihitung untuk SEMUA order sukses, ritel atau bukan.
 *
 * Barangnya benar-benar dikirim di periode ini, jadi biayanya benar-benar
 * keluar di periode ini. Menunggunya sampai merchant mentransfer akan
 * membuat Lacte terlihat lebih untung daripada kenyataannya tepat pada
 * periode ketika piutang paling besar.
 */
    totals.supplierCost += supplierCost;

    if (isMerchant) {
      /*
       * Order ritel TIDAK menambah omzet, margin, maupun jumlah order
       * pada kolom kas masuk.
       *
       * Uang dari order ini dibayar ke merchant di tokonya. Yang masuk ke
       * Lacte cuma catatan piutang; uang nyatanya baru datang lewat
       * `merchant_payments`, dan itu dihitung sebagai `merchantSettled`.
       *
       * Biaya layanannya tetap dilacak supaya bisa dicocokkan dengan yang
       * diteruskan ke merchant.
       */
      totals.merchantOrders += 1;
      totals.merchantReceivable += revenue;
      totals.merchantServiceFee += num(order.service_fee_amount);
    } else {
      totals.orders += 1;
      totals.grossRevenue += revenue;
      totals.grossProfit += profit;
      totals.discounts +=
        num(order.promotion_discount) +
        num(order.points_discount) +
        num(order.referral_discount);
      totals.affiliateCommission += num(order.affiliate_commission);
    }

    const key = dayKey(order.created_at);
    if (key) {
      const day = days.get(key) ?? {
        date: key,
        orders: 0,
        grossRevenue: 0,
        supplierCost: 0,
        profit: 0,
        merchantSettled: 0,
      };
      /*
       * Grafik harian harus ikut aturan yang sama dengan total. Kalau
       * harian masih menjumlahkan order ritel, jumlah batanganya tidak
       * akan sama dengan kartu omzet - dan operator akan-finding dua
       * laporan yang berbeda di halaman yang sama.
       */
      if (!isMerchant) {
        day.orders += 1;
        day.grossRevenue += revenue;
        day.profit += profit;
      }
      day.supplierCost += supplierCost;
      days.set(key, day);
    }

    const methodId = order.payment_method_id ?? "unknown";
    const method = methodTotals.get(methodId) ?? {
      paymentMethodId: methodId,
      orders: 0,
      revenue: 0,
      supplierCost: 0,
      profit: 0,
    };
    method.orders += 1;
    method.supplierCost += supplierCost;
    /*
     * Pendapatan per metode hanya untuk metode yang uangnya benar-benar
     * masuk lewat metode itu. "Beli di Toko Ritel" tetap punya baris
     * dengan modal dan jumlah order, tapi omzetnya nol - itu yang
     * membedakannya dari metode yang benar-benar menerima uang.
     */
    if (!isMerchant) {
      method.revenue += revenue;
      method.profit += profit;
    }
    methodTotals.set(methodId, method);
  }

  // Transfer merchant: satu-satunya arus kas masuk dari jalur ritel.
  for (const payment of merchantPayments) {
    if (!withinRange(payment.created_at)) continue;
    totals.merchantSettled += num(payment.amount);

    const key = dayKey(payment.created_at);
    if (key) {
      const day = days.get(key) ?? {
        date: key,
        orders: 0,
        grossRevenue: 0,
        supplierCost: 0,
        profit: 0,
        merchantSettled: 0,
      };
      day.merchantSettled += num(payment.amount);
      days.set(key, day);
    }
  }

  totals.marginPercent =
    totals.grossRevenue > 0
      ? Math.round((totals.grossProfit / totals.grossRevenue) * 10000) / 100
      : 0;
  totals.merchantOutstanding = totals.merchantReceivable - totals.merchantSettled;

  /*
   * Isi hari yang tanpa order dengan nol, supaya grafik tidak salah
   * menyiratkan ada order pada hari yang sebenarnya kosong. Grafik yang
   * hanya memuat hari bertransaksi akan terlihat lebih "!ramai" daripada
   * kenyataan.
   */
  const cursor = new Date(fromMs);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= toMs) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) {
      days.set(key, {
        date: key,
        orders: 0,
        grossRevenue: 0,
        supplierCost: 0,
        profit: 0,
        merchantSettled: 0,
      });
    }
    cursor.setTime(cursor.getTime() + DAY_MS);
  }

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    days: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    totals,
    byMethod: [...methodTotals.values()].sort(
      (left, right) => right.revenue - left.revenue,
    ),
  };
}

/**
 * Ubah laporan menjadi baris CSV.
 *
 * BOM UTF-8 (`\uFEFF`) ditulis di depan supaya Excel di Windows tidak
 * salah membaca sebagai ANSI. Tanpa itu, nama produk dan nama toko
 * beraksen akan tampil kisut di spreadsheet - dan ini bukan Detail
 * kecil: laporan ini justru untuk dibuka di Excel.
 *
 * Nilai numerik ditulis apa adanya (tanpa pemisah ribuan) supaya Excel
 * memperlakukannya sebagai angka dan bisa dijumlahkan. Format `Rp1.234`
 * akan terbaca sebagai teks.
 */
export function cashFlowReportToCsv(report: CashFlowReport) {
  const header = [
    "Tanggal",
    "Pesanan Selesai",
    "Omzet",
    "Biaya Supplier",
    "Margin",
    "Transfer Merchant",
  ];

  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rows = report.days.map((day) =>
    [
      day.date,
      day.orders,
      day.grossRevenue,
      day.supplierCost,
      day.profit,
      day.merchantSettled,
    ]
      .map(escape)
      .join(","),
  );

  const totals = report.totals;
  rows.push("");
  rows.push(
    [
      "TOTAL",
      totals.orders,
      totals.grossRevenue,
      totals.supplierCost,
      totals.grossProfit,
      totals.merchantSettled,
    ]
      .map(escape)
      .join(","),
  );

  // Baris ringkasan per metode pembayaran, dipisah agar tidak tercampur
  // dengan detail harian saat diimpor ke pivot table.
  rows.push("");
  rows.push(["Rincian per metode pembayaran"].map(escape).join(","));
  rows.push(["Metode", "Pesanan", "Omzet", "Biaya Supplier", "Margin"].map(escape).join(","));
  for (const method of report.byMethod) {
    rows.push(
      [
        method.paymentMethodId,
        method.orders,
        method.revenue,
        method.supplierCost,
        method.profit,
      ]
        .map(escape)
        .join(","),
    );
  }

  return `\uFEFF${[header.map(escape).join(","), ...rows].join("\r\n")}\r\n`;
}