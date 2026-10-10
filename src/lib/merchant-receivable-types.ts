/**
 * Konstanta dan tipe yang dipakai bersama oleh modul piutang server-side dan
 * modul klasifikasi murni yang bisa diuji.
 *
 * Dipisah supaya `merchant-receivable-rules.ts` tidak perlu mengimpor
 * `server-only`. File ini tidak boleh berisi nilai runtime selain konstanta
 * sederhana, supaya tidak ada urutan import yang bisa membuat cycle.
 */

/** Ambang "segera jatuh tempo", dalam hari. */
export const RECEIVABLE_DUE_SOON_DAYS = 3;

export type MerchantReceivableRow = {
  id: string;
  created_at: string;
  final_price: number | string;
  service_fee_amount: number | string | null;
  status: string;
  receivable_due_at: string | null;
  receivable_paid_at: string | null;
};

export type MerchantReceivableSummary = {
  /** Total piutang yang belum dibayar merchant (harga produk saja). */
  outstanding: number;
  /** Nilai piutang yang sudah lewat tenggat. */
  overdue: number;
  overdueCount: number;
  /** Nilai piutang yang jatuh tempo dalam 3 hari ke depan. */
  dueSoon: number;
  dueSoonCount: number;
  invoices: MerchantReceivableRow[];
};