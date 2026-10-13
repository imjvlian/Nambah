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
 *   `final_price`     yang benar-benar dibayar user. Mengandung biaya
 *                     layanan merchant.
 *   `supplier_cost`   modal yang keluar untuk fulfill order ini.
 *
 * Kenapa `final_price` BUKAN omzet Lacte
 *
 * `pricing.ts` menghitung:
 *
 *   finalPrice   = loyaltyEligibleSpend + customerPaymentFee + merchantServiceFee
 *   nambahProfit = finalPrice - merchantServiceFee - supplierCost - ...
 *
 * Jadi `merchantServiceFee` masuk ke `final_price` dan SENGAJA tidak masuk
 * ke `nambahProfit`: biaya layanan itu 100% milik merchant, Lacte tidak
 * mengambil bagiannya.
 *
 * Akibatnya, menjumlahkan `final_price` sebagai omzet akan menghitung uang
 * yang Lacte terima sambil lalu dan terus zakihkan balik ke merchant. Di
 * periode yang lewat selisihnya kecil; di periode dengan volume ritel
 * besar, omzet di laporan bisa melebihi uang yang benar-benar diperoleh
 * Lacte tepat sebesar total fee - dan persentase margin ikut turun karena
 * pembagi yang sama.
 *
 * Karena itu omzet di sini = `final_price - service_fee_amount`. Fee-nya
 * tetap ditampilkan sebagai angka tersendiri, supaya selisihnya bisa
 * diperiksa dan bukan hanya dikurangi diam-diam.
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
  /**
   * Kapan piutang merchant untuk order ini LUNAS.
   *
   * Null = uangnya belum pernah diterima Lacte (order ritel yang
   * transfer merchant-nya belum menutupnya lewat FIFO). Order ritel
   * begini TIDAK masuk omzet - menghitung piutang sebagai omzet sama
   * sahnya dengan menghitung uang yang belum pernah bergerak.
   */
  receivable_paid_at: string | null;
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
  /**
   * Omzet Lacte: `final_price` dikurangi biaya layanan merchant.
   *
   * Bukan `final_price` mentah - lihat catatan definisi harga di atas
   * file ini.
   *
   * ORDER RITEL HANYA DIHITUNG SETELAH PIUTANGNYA LUNAS
   * (`receivable_paid_at` terisi). Sebelum itu, uangnya masih di tangan
   * merchant - omzetnya belum pernah sampai ke Lacte, dan menulisnya
   * sebagai omzet membuat laporan mengaku punya uang yang belum diterima.
   */
  grossRevenue: number;
  /**
   * Total biaya layanan merchant yang dikumpulkan lalu diteruskan.
   *
   * Bukan milik Lacte. Disimpan supaya operator bisa mengonfirmasi bahwa
   * fee yang dipotong dari omzet benar-benar sebesar yang diteruskan,
   * bukan selisih pembukuan yang tidak terlihat asalnya.
   */
  merchantServiceFee: number;
  supplierCost: number;
  profit: number;
  marginPercent: number;
  /** Order yang tidak `success` dan tidak ikut dihitung sebagai pendapatan. */
  excludedCount: number;
  /** Order ritel sukses yang piutangnya BELUM dibayar merchant. */
  merchantUnpaidCount: number;
  /**
   * Nominal ritel yang menunggu pembayaran merchant.
   *
   * `final_price - service_fee` dari order-order di
   * `merchantUnpaidCount` - angka yang kelak masuk omzet begitu
   * merchant mentransfer, supaya operator tahu apa yang "hilang"
   * dari omzet bulan ini bukan lenyap, hanya tertunda.
   */
  merchantUnpaidRevenue: number;
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
  let merchantServiceFee = 0;
  let supplierCost = 0;
  let profit = 0;
  let excludedCount = 0;
  let merchantUnpaidCount = 0;
  let merchantUnpaidRevenue = 0;

  for (const row of rows) {
    if (row.status !== "success") {
      excludedCount += 1;
      continue;
    }

    const finalPrice = num(row.final_price);
    const serviceFee = num(row.service_fee_amount);

    /*
     * MODAL SUPPLIER DIHITUNG UNTUK SEMUA order sukses, ritel atau
     * bukan. Barangnya sudah dikirim supplier dan uangnya keluar dari
     * saldo supplier saat itu - menunggu merchant mentransfer tidak
     * membuat biayanya belum keluar. Ini aturan yang sama dengan
     * laporan arus kas.
     */
    supplierCost += num(row.supplier_cost);

    /*
     * ORDER RITEL YANG PIUTANGNYA BELUM DIBAYAR: uangnya masih di
     * tangan merchant. Bukan omzet hari ini - masuk
     * `merchantUnpaidRevenue` supaya operator melihat angka yang
     * tertunda, bukan hilang.
     *
     * Yang SUDAH dibayar (`receivable_paid_at` terisi lewat alokasi
     * FIFO saat transfer dicatat) dihitung normal seperti order
     * non-ritel.
     */
    if (row.merchant_id && !row.receivable_paid_at) {
      merchantUnpaidCount += 1;
      merchantUnpaidRevenue += Math.max(0, finalPrice - serviceFee);
      continue;
    }

    merchantServiceFee += serviceFee;

    /*
     * `Math.max(0, ...)` menjaga satu baris rusak tidak membuat seluruh
     * omzet negatif. Fee yang lebih besar dari harga final berarti ada
     * data yang salah di order itu - tapi itu masalahnya sendiri, bukan
     * alasan seluruh laporan jadi tidak punya makna. Baris itu tetap
     * terlihat, dan fee-nya tetap ikut dijumlahkan di atas.
     */
    grossRevenue += Math.max(0, finalPrice - serviceFee);
    profit += num(row.nambah_profit);
  }

  return {
    count: rows.length,
    grossRevenue,
    merchantServiceFee,
    supplierCost,
    profit,
    marginPercent:
      grossRevenue > 0 ? Math.round((profit / grossRevenue) * 10000) / 100 : 0,
    excludedCount,
    merchantUnpaidCount,
    merchantUnpaidRevenue,
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
    "Biaya Layanan Merchant",
    "Lunas Merchant",
    "Omzet Lacte",
    "Harga Supplier",
    "Margin Lacte",
    "Diskon Promo",
    "Komisi Affiliate",
    "Diskon Points",
  ];

  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  /*
   * Omzet dan margin per baris mengikuti ATURAN RINGKASAN, bukan data
   * mentah: order ritel yang piutangnya belum dibayar ditulis 0. Tanpa
   * ini, menjumlahkan kolom "Omzet Lacte" di Excel tidak akan sama
   * dengan baris TOTAL - dan selisihnya tidak menjelaskan dirinya.
   * Kolom "Lunas Merchant" menandai kenapa: tanggal pelunasan, atau
   * kosong untuk piutang yang masih menggantung.
   */
  const body = rows.map((row) => {
    const unpaidRetail =
      row.status === "success" && row.merchant_id && !row.receivable_paid_at;

    return [
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
      num(row.service_fee_amount),
      row.receivable_paid_at
        ? row.receivable_paid_at.slice(0, 10)
        : row.merchant_id
          ? "belum"
          : "-",
      unpaidRetail
        ? 0
        : Math.max(0, num(row.final_price) - num(row.service_fee_amount)),
      num(row.supplier_cost),
      unpaidRetail ? 0 : num(row.nambah_profit),
      num(row.promotion_discount),
      num(row.affiliate_commission),
      num(row.points_discount),
    ]
      .map(escape)
      .join(",");
  });

  const lines = [header.map(escape).join(","), ...body];

  if (summary) {
    /*
     * Baris total diberi LABEL, bukan hanya angka yang disejajarkan.
     *
     * Versi lama menaruh tiga angka di posisi kolom tertentu tanpa
     * menyatakan kolom mana yang mereka maksud. Begitu `grossRevenue` tidak
     * lagi sama dengan `final_price`, angka yang tadinya "omzet" akan
     * tetap muncul di kolom Harga Final - dan terlihat benar.
     */
    lines.push("");
    lines.push(
      ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""].join(","),
    );
    lines.push(["", "", "Omzet Lacte", summary.grossRevenue].join(","));
    lines.push(
      ["", "", "Biaya Layanan Merchant", summary.merchantServiceFee].join(","),
    );
    lines.push(["", "", "Harga Supplier", summary.supplierCost].join(","));
    lines.push(["", "", "Margin Lacte", summary.profit].join(","));
    lines.push(["", "", "Margin (%)", summary.marginPercent].join(","));
    if (summary.merchantUnpaidCount > 0) {
      lines.push(
        [
          "",
          "",
          `Ritel belum dibayar (${summary.merchantUnpaidCount} order)`,
          summary.merchantUnpaidRevenue,
        ].join(","),
      );
    }
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}