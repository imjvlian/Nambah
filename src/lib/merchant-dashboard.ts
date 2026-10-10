import "server-only";

import { supabaseSelect } from "@/lib/supabase/server";
import {
  checkMerchantCredit,
  getPendingMerchantCommitment,
} from "@/lib/merchant-retail";
import { getMerchantReceivables } from "@/lib/merchant-receivable";

/**
 * Data dashboard untuk satu merchant.
 *
 * SEMUA fungsi di file ini menerima `merchantId` dari kredensial yang sudah
 * diverifikasi server-side, bukan dari request. Tidak ada jalur di mana
 * merchant bisa membaca milik toko lain: yang menentukan adalah PIN yang
 * dicocokkan terhadap hash di database.
 */

export type MerchantDashboardInvoice = {
  orderId: string;
  createdAt: string;
  amount: number;
  dueAt: string | null;
  paidAt: string | null;
  /** Hari tersisa sampai tenggat. Negatif = sudah lewat. */
  daysRemaining: number | null;
  isOverdue: boolean;
};

export type MerchantDashboard = {
  merchant: {
    name: string;
    code: string;
    status: string;
    address: string | null;
  };
  /** Angka yang akan dilihat admin, disalin apa adanya ke toko. */
  credit: {
    outstanding: number;
    overdue: number;
    overdueCount: number;
    dueSoon: number;
    dueSoonCount: number;
    /** Order yang menunggu scan - belum jadi utang, tapi akan jadi. */
    pendingScan: number;
    limit: number;
    /** Sisa kapasitas yang boleh dipakai sebelum limit kena. */
    remaining: number;
  };
  invoices: MerchantDashboardInvoice[];
  payments: Array<{
    id: number;
    amount: number;
    note: string | null;
    recordedAt: string | null;
  }>;
};

export async function buildMerchantDashboard(
  merchantId: string,
  merchantName: string,
  merchantCode: string,
  merchantStatus: string,
  merchantAddress: string | null,
): Promise<MerchantDashboard> {
  const [receivables, credit, pendingScan, paymentRows] = await Promise.all([
    getMerchantReceivables(merchantId),
    checkMerchantCredit(merchantId),
    getPendingMerchantCommitment(merchantId),
    supabaseSelect<{
      id: number;
      amount: number | string;
      note: string | null;
      recorded_at: string | null;
    }>("merchant_payments", {
      select: "id,amount,note,recorded_at",
      filters: { merchant_id: `eq.${merchantId}` },
      order: "created_at.desc",
      limit: 50,
    }),
  ]);

  const now = Date.now();

  const invoices = receivables.invoices.map((row) => {
    const dueAt = row.receivable_due_at;
    const due = dueAt ? new Date(dueAt).getTime() : Number.NaN;
    const hasDue = Number.isFinite(due);

    return {
      orderId: row.id,
      createdAt: row.created_at,
      amount: Number(row.final_price) || 0,
      dueAt: dueAt ?? null,
      paidAt: row.receivable_paid_at,
      daysRemaining: hasDue ? Math.ceil((due - now) / 86_400_000) : null,
      isOverdue: hasDue && due < now,
    };
  });

  return {
    merchant: {
      name: merchantName,
      code: merchantCode,
      status: merchantStatus,
      address: merchantAddress,
    },
    credit: {
      outstanding: receivables.outstanding,
      overdue: receivables.overdue,
      overdueCount: receivables.overdueCount,
      dueSoon: receivables.dueSoon,
      dueSoonCount: receivables.dueSoonCount,
      pendingScan,
      limit: credit.limit,
      /*
       * Sisa kapasitas tidak boleh negatif di tampilan. Credit yang sudah
       * terlampaui bukan kondisi yang bisa dijawab dengan angka minus -
       * yang perlu ditampilkan adalah "sudah lewat", dan itu memang
       * terlihat dari `overdue` serta `remaining: 0`.
       */
      remaining: Math.max(0, credit.limit - credit.committed),
    },
    invoices,
    payments: paymentRows.map((row) => ({
      id: row.id,
      amount: Number(row.amount) || 0,
      note: row.note,
      recordedAt: row.recorded_at,
    })),
  };
}