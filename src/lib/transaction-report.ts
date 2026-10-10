import "server-only";

import {
  buildTransactionReport,
  type TransactionFilters,
  type TransactionReport,
  type TransactionRow,
  type TransactionSummary,
} from "@/lib/transaction-report-rules";
import { rangeToFilter, type ReportRange } from "@/lib/report-range";
import { supabaseSelect } from "@/lib/supabase/server";
import { gameDisplayName } from "@/lib/game-display-name";

/**
 * Pengambilan data untuk laporan transaksi.
 *
 * SEMUA BARIS DIAMBIL DI SERVER, lalu disaring dan dipaginasi di memori.
 *
 * Itu keputusan sadar, bukan kebetulan. PostgREST bisa melakukan filter
 * dan paginasi di database, tapi laporan ini butuh pencarian bebas di
 * beberapa kolom sekaligus (id, nama game, label paket, akun), dan
 * `ilike` pada empat kolom sekaligus memang lambat dan tidak memakai
 * index. Untuk volume order admin - ratusan sampai ribuan baris - menarik
 * sekali ke memori lalu menyaringnya jauh lebih sederhana dan tidak bisa
 * gagal separuh jalan.
 *
 * Batasnya jelas: `MAX_ORDERS`. Kalau periodenya melebihi itu, laporan
 * DITANDAI terpotong (lihat `truncated` di hasil) - bukan diam-diam
 * menampilkan angka yang tidak lengkap.
 */

const MAX_ORDERS = 5000;

type OrderRow = Omit<
  TransactionRow,
  "gameName" | "productLabel" | "paymentName" | "payment_id" | "game_id"
> & {
  /** Dibawa eksplisit hanya untuk lookup override `gameDisplayName`. */
  game_id: string;
  /** Nama kolom di tabel `orders`; dipetakan ke `payment_id`. */
  payment_method_id: string | null;
  game: { name: string | null; short_name: string | null } | null;
  product: { label: string | null } | null;
  payment: { name: string | null } | null;
};

/**
 * Ubah satu baris query menjadi baris laporan.
 *
 * Dipisah karena pemetaan ini identik untuk tampilan dan ekspor, dan
 * menyalinnya di dua tempat berarti nama game bisa mulai berbeda antara
 * yang terlihat di layar dan yang ada di CSV.
 */
function toTransactionRow(row: OrderRow): TransactionRow {
  return {
    id: row.id,
    created_at: row.created_at,
    status: row.status,
    reference_price: row.reference_price,
    selling_price: row.selling_price,
    final_price: row.final_price,
    supplier_cost: row.supplier_cost,
    nambah_profit: row.nambah_profit,
    promotion_discount: row.promotion_discount,
    affiliate_commission: row.affiliate_commission,
    points_discount: row.points_discount,
    merchant_id: row.merchant_id,
    service_fee_amount: row.service_fee_amount,
    target_user_id: row.target_user_id,
    payment_id: row.payment_method_id,
    gameName: row.game
      ? gameDisplayName(
          row.game_id,
          row.game.name ?? row.game.short_name ?? "Produk digital",
        )
      : null,
    productLabel: row.product?.label ?? null,
    paymentName: row.payment?.name ?? null,
  };
}

const SELECT_COLUMNS =
  "id,game_id,created_at,status,payment_method_id,reference_price,selling_price,final_price," +
  "supplier_cost,nambah_profit,promotion_discount,affiliate_commission," +
  "points_discount,merchant_id,service_fee_amount,target_user_id," +
  "game:games(name,short_name),product:products(label),payment:payment_methods(name)";

export type TransactionReportResult = TransactionReport & {
  /** True kalau jumlah baris melebihi batas dan angka bersifat parsial. */
  truncated: boolean;
};

export async function getTransactionReport(input: {
  range: ReportRange;
  filters?: TransactionFilters;
  offset?: number;
  limit?: number;
}): Promise<TransactionReportResult> {
  const rows = await supabaseSelect<OrderRow>("orders", {
    select: SELECT_COLUMNS,
    filters: rangeToFilter(input.range, "created_at"),
    order: "created_at.desc",
    limit: MAX_ORDERS,
  });

  const report = buildTransactionReport({
    rows: rows.map(toTransactionRow),
    filters: input.filters,
    offset: input.offset,
    limit: input.limit,
  });

  return { ...report, truncated: rows.length >= MAX_ORDERS };
}

/**
 * Ambil seluruh baris terfilter tanpa paginasi, untuk ekspor CSV.
 *
 * Sengaja terpisah dari `getTransactionReport`: CSV harus berisi SEMUA
 * baris yang cocok filter, bukan hanya halaman yang sedang tampil.
 * Operator yang mengunduh 7 hari transaksi dan hanya menerima 50 baris
 * akan menyimpulkan volume-nya salah.
 */
export async function getAllTransactionsForExport(input: {
  range: ReportRange;
  filters?: TransactionFilters;
}): Promise<{
  rows: TransactionRow[];
  summary: TransactionSummary;
  truncated: boolean;
}> {
  const rows = await supabaseSelect<OrderRow>("orders", {
    select: SELECT_COLUMNS,
    filters: rangeToFilter(input.range, "created_at"),
    order: "created_at.desc",
    limit: MAX_ORDERS,
  });

  const report = buildTransactionReport({
    rows: rows.map(toTransactionRow),
    filters: input.filters,
    // Limit besar supaya semua baris terfilter ikut terbawa; paginasi di
    // laporan tampilan tidak berlaku di sini.
    limit: MAX_ORDERS,
  });

  return {
    // `report.rows` sudah persis "semua baris yang lolos filter", karena
    // limit-nya lebih besar dari jumlah baris yang mungkin ada. Tidak
    // perlu mencocokkan ulang dengan `mapped` - itu hanya O(n^2) tanpa
    // menambah jaminan apa pun.
    rows: report.rows,
    summary: report.summary,
    truncated: rows.length >= MAX_ORDERS,
  };
}