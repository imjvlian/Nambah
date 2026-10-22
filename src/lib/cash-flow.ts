import "server-only";

import {
  buildCashFlowReport,
  type AffiliateWithdrawalRow,
  type CashFlowOrder,
  type CashFlowReport,
  type MerchantPaymentRow,
} from "@/lib/cash-flow-rules";
import { supabaseSelect } from "@/lib/supabase/server";
import { rangeToFilter, type ReportRange } from "@/lib/report-range";

/**
 * Pengambilan data untuk laporan arus kas.
 *
 * TIGA BATASAN YANG MEMBATAS BERAPA SAJA YANG BISA DIAMBIL
 *
 * 1. `select` hanya kolom yang dibutuhkan. `orders` punya `payment_payload`
 *    yang bisa berisi data gateway; membawanya ke server admin berarti
 *    memindahkan data pembayaran yang tidak perlu ada di sana.
 *
 * 2. Batas maksimum 5000 order per permintaan. PostgREST punya batas baris
 *    default, dan laporan yang terpotong di tengah tanpa tanda akan lebih
 *    buruk daripada laporan yang gagal dimuat sama sekali.
 *
 * 3. Rentang tanggal diterapkan DI QUERY, bukan setelahnya. Menarik semua
 *    order lalu memfilter di memori berarti memuat seluruh riwayat ke
 *    memori server untuk laporan yang mungkin hanya meminta 7 hari.
 */

const MAX_ORDERS = 5000;

/*
 * `resolveRange` dan `CashFlowRange` DIHAPUS dari file ini dan dipindah ke
 * `@/lib/report-range`.
 *
 * Alasannya bukan estetika: laporan transaksi memakai definisi periode
 * yang sama, dan dua salinan dari "7 hari berarti apa" akan menyimpang
 * begitu salah satunya diedit.
 */
export { resolveReportRange as resolveRange } from "@/lib/report-range";
export type { ReportRange as CashFlowRange } from "@/lib/report-range";

export async function getCashFlowReport(
  range: ReportRange,
  now?: number,
): Promise<CashFlowReport> {
  const [orders, merchantPayments, affiliateWithdrawals, affiliatePending] =
    await Promise.all([
      supabaseSelect<CashFlowOrder>("orders", {
        select:
          "id,status,payment_method_id,final_price,supplier_cost,nambah_profit," +
          "promotion_discount,affiliate_commission,tier2_commission,points_discount,referral_discount," +
          "merchant_id,service_fee_amount,merchant_payment_cost,created_at",
        filters: rangeToFilter(range, "created_at"),
        order: "created_at.asc",
        limit: MAX_ORDERS,
      }),
      supabaseSelect<MerchantPaymentRow>("merchant_payments", {
        select: "merchant_id,amount,created_at",
        filters: rangeToFilter(range, "created_at"),
        order: "created_at.asc",
        limit: MAX_ORDERS,
      }),
      /*
       * Pencairan LUNAS dalam rentang - difilter per `paid_at` karena
       * itulah momen uang keluar dari rekening. `status='paid'`
       * dijamin hanya terisi lewat aksi admin "Tandai sudah dibayar"
       * yang wajib membawa reference transfer.
       */
      supabaseSelect<AffiliateWithdrawalRow>("affiliate_withdrawals", {
        select: "id,amount,paid_at",
        filters: { ...rangeToFilter(range, "paid_at"), status: "eq.paid" },
        order: "paid_at.asc",
        limit: MAX_ORDERS,
      }),
      /*
       * Pencairan yang sudah di-ACC tapi belum ditransfer. Angka titik
       * waktu: TANPA filter rentang - yang sedang menggantung saat ini,
       * bukan yang ACC di periode lalu dan sudah lunas.
       */
      supabaseSelect<{ amount: number | string }>("affiliate_withdrawals", {
        select: "amount",
        filters: { status: "eq.approved" },
        limit: MAX_ORDERS,
      }),
    ]);

  const report = buildCashFlowReport({
    orders,
    merchantPayments,
    affiliateWithdrawals,
    from: range.from,
    to: range.to,
    now,
  });

  report.affiliateApprovedPending = affiliatePending.reduce(
    (total, row) => total + (Number(row.amount) || 0),
    0,
  );
  report.affiliateApprovedPendingCount = affiliatePending.length;

  return report;
}