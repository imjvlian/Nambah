import "server-only";

import { classifyReceivables } from "@/lib/merchant-receivable-rules";
import {
  RECEIVABLE_DUE_SOON_DAYS,
  type MerchantReceivableRow,
} from "@/lib/merchant-receivable-types";
import { supabaseInsert, supabaseSelect } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

/**
 * Pemeriksaan piutang merchant untuk cron.
 *
 * File ini hanya MENGAMBIL data dan menyimpan snapshot. Klasifikasi murni
 * (`classifyReceivables`) sudah diuji terpisah - mengulang aturan itu di sini
 * adalah cara pasti membuat keduanya berbeda diam-diam.
 *
 * Alert Telegram ada di `merchant-receivable-alert.ts`, terpisah karena itu
 * punya_effect ke dunia luar (mengirim pesan) dan harus bisa diuji tanpa
 * database.
 */

export type ReceivableMerchantRow = {
  id: string;
  name: string;
  status: string;
  payment_term_days: number;
};

export type MerchantReceivableStatus = {
  merchantId: string;
  merchantName: string;
  status: "healthy" | "due_soon" | "overdue" | "unknown";
  outstanding: number;
  overdue: number;
  overdueCount: number;
  dueSoon: number;
  dueSoonCount: number;
  /** Order paling lama yang belum dibayar. */
  oldestDueAt: string | null;
  checkedAt: string;
};

async function loadUnpaidInvoices(): Promise<
  Array<MerchantReceivableRow & { merchant_id: string }>
> {
  return supabaseSelect<
    MerchantReceivableRow & { merchant_id: string }
  >("orders", {
    select:
      "id,merchant_id,created_at,final_price,service_fee_amount,status,receivable_due_at,receivable_paid_at",
    filters: {
      merchant_id: "not.is.null",
      // Order merchant tetap berstatus `success` setelah top up. Filter
      // `status` ATAU `receivable_paid_at` keduanya wajib: yang pertama
      // membuang order yang gagal/batal, yang kedua membuang yang sudah lunas.
      status: "eq.success",
      receivable_paid_at: "is.null",
    },
    order: "receivable_due_at.asc",
    limit: 1000,
  });
}

/**
 * Hitung posisi piutang tiap merchant yang punya tagihan berjalan.
 *
 * Merchant tanpa piutang TIDAK dikembalikan. Memasukkannya akan membuat
 * snapshot dan alert melihat daftar yang isinya didominasi merchant yang
 * tidak melakukan apa-apa - dan secara bertahap semua merchant akan
 * menerima notifikasi yang tidak berguna.
 */
export async function collectMerchantReceivableStatuses(
  now = Date.now(),
): Promise<MerchantReceivableStatus[]> {
  const invoices = await loadUnpaidInvoices();
  if (invoices.length === 0) return [];

  const byMerchant = new Map<string, MerchantReceivableRow[]>();
  for (const invoice of invoices) {
    const list = byMerchant.get(invoice.merchant_id);
    if (list) list.push(invoice);
    else byMerchant.set(invoice.merchant_id, [invoice]);
  }

  // Hanya merchant yang benar-benar punya piutang yang perlu diperiksa
  // status - bukan seluruh tabel merchants.
  const merchantIds = [...byMerchant.keys()];
  const merchants = await supabaseSelect<ReceivableMerchantRow>("merchants", {
    select: "id,name,status,payment_term_days",
    filters: { id: `in.(${merchantIds.join(",")})` },
    limit: merchants_limit(merchantIds.length),
  });

  const byId = new Map(merchants.map((merchant) => [merchant.id, merchant]));
  const checkedAt = new Date(now).toISOString();
  const results: MerchantReceivableStatus[] = [];

  for (const [merchantId, rows] of byMerchant) {
    const merchant = byId.get(merchantId);
    const summary = classifyReceivables(
      rows.map((row) => ({
        final_price: Number(row.final_price) || 0,
        receivable_due_at: row.receivable_due_at,
      })),
      now,
    );

    /*
     * `unknown` dipakai kalau tidak ada satu pun order yang punya tenggat.
     * Merchant seperti itu tidak bisa ditegur, jadi tidak boleh muncul di
     * alert - tapi tetap di-snapshot supaya kelihatan di dashboard.
     */
    let status: MerchantReceivableStatus["status"] = "healthy";
    if (summary.overdueCount > 0) status = "overdue";
    else if (summary.dueSoonCount > 0) status = "due_soon";
    else if (rows.every((row) => !row.receivable_due_at)) status = "unknown";

    const dated = rows
      .map((row) => row.receivable_due_at)
      .filter((value): value is string => Boolean(value))
      .sort();

    results.push({
      merchantId,
      merchantName: merchant?.name ?? merchantId,
      status,
      outstanding: summary.outstanding,
      overdue: summary.overdue,
      overdueCount: summary.overdueCount,
      dueSoon: summary.dueSoon,
      dueSoonCount: summary.dueSoonCount,
      oldestDueAt: dated[0] ?? null,
      checkedAt,
    });
  }

  return results.sort((left, right) => right.overdue - left.overdue);
}

function merchants_limit(count: number) {
  // PostgREST `in.(...)` punya batas panjang URL. 200 merchant sekali jalan
  // sudah jauh melebihi kebutuhan saat ini, tapiDijaga supaya tidak diam-diam
  // terpotong kalau daftar merchant tumbuh.
  return Math.min(Math.max(count, 1), 200);
}

/**
 * Simpan snapshot ke `merchant_balance_snapshots`.
 *
 * Sengaja tabel snapshot, bukan update ke `merchant_balances`: tabel itu
 * menyimpan angka untuk tampilan, tabel ini menyimpan histori. Cron tidak
 * boleh mengubah angka kas - hanya mencatat apa yang dilihatnya.
 *
 * PENGGUNAAN INSERT, BUKAN UPSERT.
 *
 * `merchant_balance_snapshots` tidak punya unique constraint apa pun -
 * primary key-nya surrogate `id`, dan `merchant_balance_snapshots_lookup_idx`
 * hanya index biasa (migrasi 036). Memakai `on_conflict` di sana akan gagal
 * dengan error PostgREST yang tidak menjelaskan apa pun yang salah.
 *
 * Duplikat dari timer yang terpicu dua kali memang mungkin, dan itu memang
 * yang diinginkan: snapshot adalah catatan historis, bukan state. Yang
 * membuat alert tidak dobel adalah `dedupeKey` di telegram_delivery_log,
 * bukan tabel ini.
 */
export async function snapshotMerchantReceivables(
  statuses: MerchantReceivableStatus[],
): Promise<number> {
  if (statuses.length === 0) return 0;

  await supabaseInsert(
    "merchant_balance_snapshots",
    statuses.map((status) => ({
      merchant_id: status.merchantId,
      balance: status.outstanding,
      status: status.status,
      checked_at: status.checkedAt,
    })),
  );

  return statuses.length;
}

export { RECEIVABLE_DUE_SOON_DAYS, BRAND };