/**
 * Aturan laporan transaksi — bagian MURNI, tanpa I/O.
 *
 * Dipisah dari `transaction-report.ts` karena modul latter mengimpor
 * `server-only` dan Supabase. Laporan transaksi adalah fitur yang paling
 * sering dipakai admin untuk menjawab "ke mana uangnya pergi", jadi
 * perhitungan penyeimbangannya harus bisa diuji tanpa database.
 *
 * DEFINISI HARGA YANG TIDAK BOLEH DICAMPUR
 *
 * Satu order punya EMPAT angka harga, dan mencampurkannya adalah cara
 * paling umum membuat laporan transaksi terlihat salah:
 *
 *   `reference_price`  harga katalog sebelum diskon apa pun.
 *   `selling_price`   harga yang ditawarkan ke user SEBELUM promo, poin,
 *                     referral, dan biaya layanan merchant.
 *   `final_price`     yang benar-benar dibayar user. Inilah satu-satunya
 *                     angka yang boleh disebut "pendapatan".
 *   `supplier_cost`   modal yang keluar untuk fulfill order ini.
 *
 * Selisih `final_price - supplier_cost` BUKAN margin Lacte, karena masih
 * ada diskon, komisi affiliate, dan poin yang terpotong dari sana. Margin
 * yang benar adalah `nambah_profit`, yang sudah dihitung `pricing.ts` dan
 * disimpan saat checkout. Laporan ini memakai `nambah_profit`, bukan
 * menghitung ulang - kalau dihitung ulang, angka yang muncul di laporan
 * akan berbeda dari yang tercatat di order.
 */

export type TransactionRow = {
  id: string;
  created_at: string;
  status: string;
  /** Nama game dari tabel `games`. */
  gameName: string | null;
  /** Label paket dari tabel `products`. */
  productLabel: string | null;
  /** Id metode dari `orders.payment_method_id` - dipakai untuk filter. */
  payment_id: string | null;
  /** Nama metode dari tabel `payment_methods` - dipakai untuk tampilan. */
  paymentName: string | null;
  reference_price: number | string;
  selling_price: number | string;
  final_price: number | string;
  supplier_cost: number | string;
  nambah_profit: number | string;
  promotion_discount: number | string;
  affiliate_commission: number | string;
  points_discount: number | string;
  merchant_id: string | null;
  service_fee_amount: number | string | null;
  target_user_id: string | null;
};

export type TransactionFilters = {
  /** Pencarian bebas: id order, nama game, label paket, atau target. */
  query?: string | null;
  /** Filter status. Kosong = semua status. */
  status?: string | null;
  /** Filter metode pembayaran. Kosong = semua metode. */
  payment?: string | null;
};

export type TransactionSummary = {
  count: number;
  grossRevenue: number;
  supplierCost: number;
  profit: number;
  marginPercent: number;
  /** Order yang tidak `success` dan tidak ikut dihitung sebagai pendapatan. */
  excludedCount: number;
};

export type TransactionReport = {
  rows: TransactionRow[];
  summary: TransactionSummary;
  /** Jumlah baris setelah filter, sebelum pagination. */
  totalFiltered: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

/** Batas baris per halaman di antarmuka. */
export const TRANSACTION_PAGE_SIZE = 50;

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalize teks pencarian.
 *
 * Huruf besar/kecil diabaikan, dan spasi berlebih dirapatkan. Ini bukan
 * HASIL: admin akan mengetik "google play" dengan spasi ganda, dan
 * jawaban "tidak ditemukan" untuk itu sangat membingungkan.
 */
export function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cocokkan satu baris dengan pencarian bebas.
 *
 * Semua field yang dicari operator dimasukkan: id order (untuk menelusuri
 * laporan_manual), nama game, label paket, dan target user (untuk
 * menjawab "pesanan untuk user ini berapa?"). Pencarian hanya berdiri
 * dari `id` akan membuat kolom "Akun" di tampilan tidak bisa difilter
 * padahal kelihatan jelas di layar.
 */
export function matchesTransaction(row: TransactionRow, query: string) {
  const needle = normalizeSearch(query);
  if (!needle) return true;

  return [row.id, row.gameName, row.productLabel, row.paymentName, row.target_user_id]
    .filter((value): value is string => typeof value === "string")
    .some((value) => normalizeSearch(value).includes(needle));
}

/**
 * Cocokkan baris dengan filter metode pembayaran.
 *
 * Dicocokkan ke `payment_id` dengan LITERAL, bukan ke nama tampilan.
 *
 * Alasannya nama tampilan berubah tanpa operator diberi tahu: "Beli di
 * Toko Ritel" bisa saja diubah jadi apa saja nanti, dan filter yang
 * bergantung pada teks itu ikut mati. `payment_id` adalah kunci yang
 * dijamin tidak berubah selama baris `payment_methods` masih ada.
 *
 * `payment_id` sengaja TIDAK diambil lewat query. Kolom itu sudah ada di
 * baris sebagai `payment_id` dan diisi saat pemetaan, jadi tidak perlu
 * satu kolom lagi yang bisa berbeda antara filter dan tampilan.
 */
export function matchesPayment(row: TransactionRow, payment: string) {
  const needle = payment.trim().toLowerCase();
  if (!needle) return true;
  return (row.payment_id ?? "").toLowerCase() === needle;
}

/**
 * Ringkasan dari sekumpulan baris yang sudah terfilter.
 *
 * Hanya `success` yang dihitung sebagai pendapatan. Order `cancelled` dan
 * `failed` tetap dihitung sebagai `excludedCount` supaya operator bisa
 * melihat bahwa mereka ada. Order yang hilang dari laporan tanpa
 * penjelasan adalah sumber kebingungan paling umum di laporan keuangan.
 */
export function summarizeTransactions(
  rows: TransactionRow[],
): TransactionSummary {
  let grossRevenue = 0;
  let supplierCost = 0;
  let profit = 0;
  let excludedCount = 0;

  for (const row of rows) {
    if (row.status !== "success") {
      excludedCount += 1;
      continue;
    }
    grossRevenue += num(row.final_price);
    supplierCost += num(row.supplier_cost);
    profit += num(row.nambah_profit);
  }

  return {
    count: rows.length,
    grossRevenue,
    supplierCost,
    profit,
    marginPercent:
      grossRevenue > 0 ? Math.round((profit / grossRevenue) * 10000) / 100 : 0,
    excludedCount,
  };
}

/**
 * Saring, ringkas, lalu paginasikan.
 *
 * RINGKASAN DIHITUNG SEBELUM PAGINASI, bukan sesudahnya. Kalau dihitung
 * dari baris yang sedang ditampilkan, total pada halaman kedua akan
 * lebih kecil dari halaman pertama - dan itu akan dibaca sebagai "omzet
 * turun drastis", bukan sebagai artifact pagination.
 */
export function buildTransactionReport(input: {
  rows: TransactionRow[];
  filters?: TransactionFilters;
  offset?: number;
  limit?: number;
}): TransactionReport {
  const { rows, filters = {} } = input;
  const limit = Math.min(
    Math.max(Number(input.limit) || TRANSACTION_PAGE_SIZE, 1),
    200,
  );
  const offset = Math.max(Number(input.offset) || 0, 0);

  const query = filters.query?.trim() ?? "";
  const status = filters.status?.trim() ?? "";
  const payment = filters.payment?.trim() ?? "";

  const filtered = rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (payment && !matchesPayment(row, payment)) return false;
    return matchesTransaction(row, query);
  });

  return {
    rows: filtered.slice(offset, offset + limit),
    summary: summarizeTransactions(filtered),
    totalFiltered: filtered.length,
    offset,
    limit,
    hasMore: offset + limit < filtered.length,
  };
}

/**
 * Ubah laporan transaksi menjadi CSV.
 *
 * Menghasilkan SEMUA baris terfilter, bukan hanya halaman yang tampil.
 * Operator yang mengunduh 7 hari transaksi dan hanya mendapat 50 baris
 * akan menarik kesimpulan yang salah tentang volume transaksi.
 *
 * Karena itu `rows` yang dipanggil adalah hasil filter lengkap, bukan
 * `report.rows` yang sudah dipaginasi.
 *
 * BOM UTF-8 ditulis di depan (`\uFEFF`) supaya Excel di Windows tidak
 * salah membaca sebagai ANSI. Perhatikan: BOM ini HAPUS saat body
 * dikirim sebagai string lewat `Response` - route harus mengirim
 * `Uint8Array`, bukan string.
 */
export function transactionsToCsv(
  rows: TransactionRow[],
  summary?: TransactionSummary,
) {
  const header = [
    "ID Order",
    "Tanggal",
    "Status",
    "Game",
    "Item",
    "Metode Bayar",
    "Akun",
    "Harga Katalog",
    "Harga Jual",
    "Harga Final",
    "Harga Supplier",
    "Margin Lacte",
    "Diskon Promo",
    "Komisi Affiliate",
    "Diskon Points",
    "Biaya Layanan Merchant",
  ];

  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const body = rows.map((row) =>
    [
      row.id,
      row.created_at,
      row.status,
      row.gameName ?? "-",
      row.productLabel ?? "-",
      row.paymentName ?? "-",
      row.target_user_id ?? "-",
      num(row.reference_price),
      num(row.selling_price),
      num(row.final_price),
      num(row.supplier_cost),
      num(row.nambah_profit),
      num(row.promotion_discount),
      num(row.affiliate_commission),
      num(row.points_discount),
      num(row.service_fee_amount),
    ]
      .map(escape)
      .join(","),
  );

  const lines = [header.map(escape).join(","), ...body];

  if (summary) {
    lines.push("");
    lines.push(
      [
        "TOTAL",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        summary.grossRevenue,
        summary.supplierCost,
        summary.profit,
      ]
        .map(escape)
        .join(","),
    );
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}