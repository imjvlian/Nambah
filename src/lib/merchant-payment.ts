import "server-only";

import {
  planPaymentAllocation,
  normalizeAmount,
  type PayableInvoice,
} from "@/lib/merchant-payment-rules";
import { syncMerchantBalance } from "@/lib/merchant-retail";
import {
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

/**
 * Pencatatan pelunasan merchant.
 *
 * Alur bisnisnya: merchant transfer ke Lacte, lalu admin mencatatnya di sini.
 * Yang dicatat adalah besaran uang yang benar-benar diterima - bukan order yang
 * "sudah dibayar". Karena itu `merchant_payments` sengaja tidak punya
 * `order_id`: satu transfer bisa menutup beberapa piutang sekaligus, dan
 * memaksakan satu order per transfer akan membuat admin memecah catatan
 * yang sebenarnya utuh.
 *
 * Alokasi ke order dikerjakan oleh `planPaymentAllocation` (FIFO) yang murni
 * dan sudah diuji. File ini hanya bertugas menulis hasilnya ke database.
 */

export type MerchantPaymentMethod = "transfer" | "cash" | "other";

export type RecordMerchantPaymentInput = {
  merchantId: string;
  amount: number | string;
  method?: MerchantPaymentMethod;
  reference?: string | null;
  note?: string | null;
  recordedBy?: string | null;
};

export type RecordMerchantPaymentResult = {
  paymentId: number | null;
  amount: number;
  applied: number;
  credit: number;
  settledCount: number;
  /** Order yang masih owes setelah pembayaran ini. */
  remainingCount: number;
  remainingOutstanding: number;
};

const METHODS: MerchantPaymentMethod[] = ["transfer", "cash", "other"];

function normalizeMethod(value: unknown): MerchantPaymentMethod {
  if (typeof value !== "string") return "transfer";
  const candidate = value.trim().toLowerCase();
  return (METHODS as string[]).includes(candidate)
    ? (candidate as MerchantPaymentMethod)
    : "transfer";
}

/**
 * Piutang yang sedang berjalan untuk satu merchant.
 *
 * Filter `status = success` + `receivable_paid_at is null` adalah definisi
 * yang benar dan BUKAN shorthand: order merchant tetap berstatus `success`
 * setelah top up (mengubahnya ke `awaiting_receivable` merusak points,
 * komisi, promo, dan receipt), jadi piutang dicatat di kolomnya sendiri.
 */
async function getPayableInvoices(
  merchantId: string,
): Promise<PayableInvoice[]> {
  const rows = await supabaseSelect<{
    id: string;
    final_price: number | string;
    receivable_due_at: string | null;
    created_at: string;
  }>("orders", {
    select: "id,final_price,receivable_due_at,created_at",
    filters: {
      merchant_id: `eq.${merchantId}`,
      status: "eq.success",
      receivable_paid_at: "is.null",
    },
    order: "created_at.asc",
    limit: 1000,
  });

  return rows.map((row) => ({
    orderId: row.id,
    finalPrice: Number(row.final_price) || 0,
    receivableDueAt: row.receivable_due_at,
    createdAt: row.created_at,
  }));
}

export async function recordMerchantPayment(
  input: RecordMerchantPaymentInput,
): Promise<RecordMerchantPaymentResult> {
  const merchantId = String(input.merchantId ?? "").trim();
  if (!merchantId) {
    throw new Error("ID merchant wajib diisi.");
  }

  const amount = normalizeAmount(input.amount);

  const [merchant] = await supabaseSelect<{ id: string; name: string }>(
    "merchants",
    {
      select: "id,name",
      filters: { id: `eq.${merchantId}` },
      limit: 1,
    },
  );

  if (!merchant) {
    throw new Error("Merchant tidak ditemukan.");
  }

  const invoices = await getPayableInvoices(merchantId);
  const plan = planPaymentAllocation(invoices, amount);

  const now = new Date().toISOString();

  /*
   * Catat pembayaran DULU, sebelum menyentuh order.
   *
   * Urutan ini penting: `merchant_payments` tidak punya FK ke order, jadi
   * kalau insert-nya gagal tidak ada yang berubah sama sekali. Sebaliknya,
   * kalau urutannya dibalik dan langkah kedua gagal, kita akan punya order
   * yang ditandai lunas tanpa ada bukti transfernya - keadaan yang jauh
   * lebih sulit dijelaskan ulang daripada catatan yang dobel.
   */
  const [payment] = await supabaseInsert<{ id: number }>(
    "merchant_payments",
    {
      merchant_id: merchantId,
      amount,
      method: normalizeMethod(input.method),
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      recorded_by: input.recordedBy ?? null,
      created_at: now,
    },
  );

  const paymentId = payment?.id ?? null;

  /*
   * Tandai order yang lunas.
   *
   * `receivable_paid_at is null` di filter membuat langkah ini idempoten:
   * menjalankan ulang payload yang sama tidak akan menandai order yang sudah
   * lunas untuk kedua kalinya.
   *
   * Order yang hanya terpubei SEBAGIAN sengaja TIDAK ditandai. Menandainya
   * sebagai lunas akan menghilangkan sisa tagihannya dari piutang.
   */
  for (const entry of plan.settled) {
    if (entry.partial) continue;

    await supabaseUpdate(
      "orders",
      { receivable_paid_at: now, updated_at: now },
      {
        filters: {
          id: `eq.${entry.orderId}`,
          receivable_paid_at: "is.null",
        },
      },
    );
  }

  /*
   * Cache saldo di-refresh setelah semua penulisan selesai.
   *
   * Sisa bayar TIDAK ditulis manual di sini. `syncMerchantBalance` menghitung
   * `piutang - sisa bayar` dari `merchant_payments` dan order yang sudah
   * lunas, jadi kredit otomatis ikut terhitung.
   *
   * Versi sebelumnya menulis `balance` secara manual DAN memanggil sync
   * sesudahnya - dan sync menimpanya dengan piutang mentah, sehingga
   * kelebihan bayar hilang: Rp91.800 lenyap begitu saja. Sekarang
   * hanya ada satu sumber kebenaran.
   */
  const outstanding = await syncMerchantBalance(merchantId);

  return {
    paymentId,
    amount,
    applied: plan.applied,
    credit: plan.credit,
    settledCount: plan.settled.filter((entry) => !entry.partial).length,
    remainingCount: plan.remaining.length,
    remainingOutstanding: outstanding,
  };
}