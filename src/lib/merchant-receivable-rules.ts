import { RECEIVABLE_DUE_SOON_DAYS } from "@/lib/merchant-receivable-types";

/**
 * Klasifikasi piutang - bagian MURNI, tanpa I/O.
 *
 * Dipisah dari `merchant-receivable.ts` karena modul itu mengimpor
 * `server-only` dan Supabase. Logika klasifikasi adalah inti dari cron
 * alert piutang, dan salah klasifikasi punya dua akibat yang sama buruk:
 * merchant yang belum bayar dapat alert "terlambat" (merusak hubungan), atau
 * merchant yang benar-benar lewat tidak dapat alert sama sekali (uang
 * tertahan tanpa terlihat).
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export type ReceivableInput = {
  final_price: number;
  receivable_due_at: string | null;
};

/**
 * Kelompokkan piutang berdasarkan jarak ke tenggat.
 *
 * Filter "sudah dibayar" SENGAJA tidak dilakukan di sini - pemanggil yang
 * memfilter lewat query. Menggandakan aturan itu di dua tempat adalah cara
 * pasti membuat keduanya berbeda diam-diam.
 */
export function classifyReceivables(
  invoices: ReceivableInput[],
  now = Date.now(),
): {
  outstanding: number;
  overdue: number;
  overdueCount: number;
  dueSoon: number;
  dueSoonCount: number;
} {
  const dueSoonCutoff = now + RECEIVABLE_DUE_SOON_DAYS * DAY_MS;

  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  let dueSoon = 0;
  let dueSoonCount = 0;

  for (const invoice of invoices) {
    outstanding += invoice.final_price;

    // Tanpa tenggat, invoice tidak bisa diklasifikasikan. Tetap masuk
    // outstanding - uangnya tetap milik Lacte, hanya tidak bisa ditegur.
    if (!invoice.receivable_due_at) continue;
    const due = new Date(invoice.receivable_due_at).getTime();
    if (!Number.isFinite(due)) continue;

    if (due < now) {
      overdue += invoice.final_price;
      overdueCount += 1;
    } else if (due <= dueSoonCutoff) {
      dueSoon += invoice.final_price;
      dueSoonCount += 1;
    }
  }

  return { outstanding, overdue, overdueCount, dueSoon, dueSoonCount };
}
