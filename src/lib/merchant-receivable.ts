import "server-only";

import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import {
  type MerchantReceivableRow,
  type MerchantReceivableSummary,
} from "@/lib/merchant-receivable-types";
import { classifyReceivables } from "@/lib/merchant-receivable-rules";

/**
 * Piutang merchant: dari order yang baru saja sukses sampai merchant transfer.
 *
 * MENGAPA ORDER MERCHANT TIDAK LANGSUNG DI SET `awaiting_receivable`
 *
 * `finalizeOrder` di `fulfillment.ts` menutup order dengan status `success`
 * plus `terminal_at`. Order dianggap selesai oleh semua sistem lain:
 * points, komisi affiliate, promo, receipt, rekonsiliasi supplier.
 *
 * Kalau order merchant ikut di set `awaiting_receivable` di titik yang sama,
 * ia ceases menjadi `success` - dan itu merusak semuanya: lifecycle points
 * tidak dipanggil, receipt tidak terkirim, dan `TERMINAL_STATUSES` tidak
 * mengenali order yang sebenarnya sudah selesai untuk customer.
 *
 * Yang benar: biarkan order tetap `success` (customer sudah dapat top up,
 * itu faktanya), dan catat piutang di kolomnya sendiri
  * (`receivable_due_at` / `receivable_paid_at`). Piutang adalah realitas
  * akuntansi, bukan tahap dari lifecycle pesanan.
 *
 * Konsekuensinya, `awaiting_receivable` dipakai sebagai filter di query
 * piutang, BUKAN sebagai status yang disimpan. Status itu tetap ada di
 * migration untuk order lama/manuel, tapi jalur normal tidak memakainya.
 */

/**
 * Tandai piutang untuk satu order merchant yang baru saja sukses.
 *
 * Idempoten lewat `receivable_paid_at is null` di filter. Kalau order ini
 * somehow diproses dua kali, `receivable_due_at` tidak akan digeser ke
 * belakang - menggeser tenggat tanpa disengaja berarti memberi merchant
 * ruang untuk menunda pelunasan.
 */
export async function openMerchantReceivable(
  orderId: string,
  paymentTermDays: number,
  fulfilledAt: string,
): Promise<void> {
  const days =
    Number.isInteger(paymentTermDays) && paymentTermDays >= 1 ? paymentTermDays : 7;

  const dueAt = new Date(
    new Date(fulfilledAt).getTime() + days * 24 * 60 * 60 * 1000,
  ).toISOString();

  await supabaseUpdate(
    "orders",
    { receivable_due_at: dueAt, updated_at: new Date().toISOString() },
    {
      filters: {
        id: `eq.${orderId}`,
        merchant_id: "not.is.null",
        // Sudah dibayar merchant: jangan buka piutang baru.
        receivable_paid_at: "is.null",
      },
    },
  );
}

export async function getMerchantReceivables(
  merchantId: string,
): Promise<MerchantReceivableSummary> {
  const rows = await supabaseSelect<MerchantReceivableRow>("orders", {
    select:
      "id,created_at,final_price,service_fee_amount,status,receivable_due_at,receivable_paid_at",
    filters: {
      merchant_id: `eq.${merchantId}`,
      status: "eq.success",
      receivable_paid_at: "is.null",
    },
    order: "receivable_due_at.asc",
  });

  const summary = classifyReceivables(
    rows.map((row) => ({
      final_price: Number(row.final_price) || 0,
      receivable_due_at: row.receivable_due_at,
    })),
  );

  return { ...summary, invoices: rows };
}
