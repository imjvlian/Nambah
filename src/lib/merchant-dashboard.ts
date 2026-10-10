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

export type MerchantTransaction = {
  orderId: string;
  createdAt: string;
  /** Yang dibayar pelanggan ke merchant = harga produk + biaya layanan. */
  amount: number;
  /** Bagian yang jadi pendapatan merchant. */
  serviceFee: number;
  productLabel: string | null;
  status: string;
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
  /**
   * Omzet toko, dihitung dari `service_fee_amount`.
   *
   * BUKAN dari `final_price`. Yang diterima merchant hanya biaya layanan;
   * harga produk diteruskan ke Lacte untuk membayar supplier. Menampilkan
   * `final_price` sebagai omzet akan membuat toko merasa thrive padahal
   * uangnya belum pernah masuk ke tangan mereka.
   */
  earnings: {
    today: number;
    todayCount: number;
    week: number;
    weekCount: number;
    month: number;
    monthCount: number;
    allTime: number;
    allTimeCount: number;
  };
  invoices: MerchantDashboardInvoice[];
  transactions: MerchantTransaction[];
  payments: Array<{
    id: number;
    amount: number;
    note: string | null;
    recordedAt: string | null;
  }>;
};

const DAY_MS = 86_400_000;

type OrderStatRow = {
  id: string;
  created_at: string;
  final_price: number | string;
  service_fee_amount: number | string | null;
  status: string;
};

export async function buildMerchantDashboard(
  merchantId: string,
  merchantName: string,
  merchantCode: string,
  merchantStatus: string,
  merchantAddress: string | null,
): Promise<MerchantDashboard> {
  const [receivables, credit, pendingScan, paymentRows, orderRows] =
    await Promise.all([
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
      /*
       * Hanya order yang SUDAH lewat scan kasir yang dihitung. `pending_merchant`
       * belum apa-apa: customer belum tentu datang, dan kalau batal tidak ada
       * yang pernah dibayar.
       *
       * `failed` dan `refunded` SENGAJA TIDAK dihitung. Di kedua status itu
       * top up tidak berhasil, jadi toko wajib mengembalikan uang ke
       * customer - menghitungnya sebagai omzet akan membuat toko melihat
       * pendapatan yang harus ia kembalikan.
       */
      supabaseSelect<OrderStatRow>("orders", {
        select: "id,created_at,final_price,service_fee_amount,status",
        filters: {
          merchant_id: `eq.${merchantId}`,
          status: "in.(paid,processing,success)",
        },
        order: "created_at.desc",
        limit: 1000,
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

  /*
   * Batas periode memakai offset dari SEKARANG, bukan kalender. Untuk
   * dashboard yang di-refresh setiap beberapa detik, "hari ini" yang
   * dihitung dari tengah malam akan melompat saat tengah malam - dan
   * omzet yang tiba-tiba nol jauh lebih membingungkan daripada yang salah
   * beberapa menit.
   */
  const todayStart = now - DAY_MS;
  const weekStart = now - 7 * DAY_MS;
  const monthStart = now - 30 * DAY_MS;

  let today = 0;
  let todayCount = 0;
  let week = 0;
  let weekCount = 0;
  let month = 0;
  let monthCount = 0;
  let allTime = 0;
  let allTimeCount = 0;

  for (const row of orderRows) {
    const fee = Number(row.service_fee_amount ?? 0) || 0;
    const at = new Date(row.created_at).getTime();
    if (!Number.isFinite(at)) continue;

    allTime += fee;
    allTimeCount += 1;

    if (at >= monthStart) {
      month += fee;
      monthCount += 1;
    }
    if (at >= weekStart) {
      week += fee;
      weekCount += 1;
    }
    if (at >= todayStart) {
      today += fee;
      todayCount += 1;
    }
  }

  const transactions = orderRows.slice(0, 50).map((row) => ({
    orderId: row.id,
    createdAt: row.created_at,
    amount: Number(row.final_price) || 0,
    serviceFee: Number(row.service_fee_amount ?? 0) || 0,
    productLabel: null,
    status: row.status,
  }));

  return {
    merchant: {
      name: merchantName,
      code: merchantCode,
      status: merchantStatus,
      address: merchantAddress,
    },
    earnings: {
      today,
      todayCount,
      week,
      weekCount,
      month,
      monthCount,
      allTime,
      allTimeCount,
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
    transactions,
    payments: paymentRows.map((row) => ({
      id: row.id,
      amount: Number(row.amount) || 0,
      note: row.note,
      recordedAt: row.recorded_at,
    })),
  };
}