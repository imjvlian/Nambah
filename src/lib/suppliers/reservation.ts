import { supabaseRpc, supabaseSelect } from "@/lib/supabase/server";
import type { SupplierId } from "@/lib/suppliers/types";

/**
 * Penguncian saldo supplier.
 *
 * SEMUA operasi di sini lewat RPC Postgres, bukan baca-tulis dari aplikasi.
 *
 * KENAPA TIDAK BISA DILAKUKAN DI APLIKASI
 *
 * "baca saldo -> cek cukup -> tulis" punya celah di antara kedua langkah.
 * Dua order yang datang bersamaan bisa dua-duanya membaca angka yang sama,
 * lalu dua-duanya mengunci, padahal saldonya hanya cukup untuk satu. Order
 * akan ditolak supplier SETELAH pembeli membayar.
 *
 * PostgREST juga tidak bisa dipakai untuk menutup celah itu: filter-nya
 * hanya membandingkan satu kolom dengan literal, bukan antar kolom. Jadi
 * `?balance-reserved_balance=gte.60000` tidak ada.
 *
 * Yang bisa menutupnya adalah satu `update ... where` di dalam satu
 * transaksi Postgres - persis apa yang dilakukan oleh ketiga fungsi di
 * migrasi 041.
 *
 * KENAPA TIDAK ADA PARAMETER ORDER DI SINI
 *
 * Modul ini sengaja tidak tahu apa itu order. Yang diteruskan hanya id
 * supplier dan nominal. Kalau modul ini menerima `orderId`, pemanggil akan
 * tergoda menghitung sisa kuota dari order, dan itu menggandakan aturan
 * bisnis yang sudah hidup di `supplier_transactions`.
 */

export type ReservationOutcome = "ok" | "insufficient" | "supplier-missing";

/**
 * Kunci `amount` rupiah untuk `supplierId`.
 *
 * Mengembalikan `"insufficient"` - bukan melempar - saat saldo tidak cukup.
 * Pemanggil ada di jalur checkout, dan itu bukan kondisi exceptional: saldo
 * habis adalah jawaban yang sah untuk "produk ini sedang tidak bisa
 * dibeli". Melempar exception di sini akan mengubahnya jadi 500, yang
 * terlihat seperti server rusak.
 */
export async function reserveSupplierBalance(
  supplierId: SupplierId,
  amount: number,
): Promise<ReservationOutcome> {
  const rupiah = Math.round(Number(amount));

  /*
   * Guard yang sama dengan guard di dalam fungsi SQL.
   *
   * Diulang di sini karena mismatch antara guard aplikasi dan guard
   * database akan muncul sebagai "saldo selalu cukup" - hasil yang terlihat
   * benar padahal tidak ada reservasi yang terjadi. Lebih baik return
   * "insufficient" dan tidak locked apa pun daripada silent fail.
   */
  if (!Number.isFinite(rupiah) || rupiah <= 0) return "insufficient";

  if (!(await supplierExists(supplierId))) return "supplier-missing";

  const ok = await supabaseRpc<boolean>("reserve_supplier_balance", {
    p_supplier_id: supplierId,
    p_amount: rupiah,
  });

  return ok === true ? "ok" : "insufficient";
}

/**
 * Transaksi supplier sukses: uang keluar dari saldo supplier.
 *
 * `reserved_balance` turun DAN `balance` turun, dalam satu statement.
 */
export async function commitSupplierReservation(
  supplierId: SupplierId,
  amount: number,
): Promise<boolean> {
  const rupiah = Math.round(Number(amount));
  if (!Number.isFinite(rupiah) || rupiah <= 0) return false;

  return (
    (await supabaseRpc<boolean>("commit_supplier_reservation", {
      p_supplier_id: supplierId,
      p_amount: rupiah,
    })) === true
  );
}

/**
 * Transaksi gagal, order batal, atau order kedaluwarsa.
 *
 * HANYA `reserved_balance` yang turun. Saldo lokal tidak disentuh: uangnya
 * sudah dikembalikan supplier, dan nilainya akan disegarkan job cek saldo.
 * Mengurangi dua-duanya akan menghormati saldo dua kali.
 */
export async function releaseSupplierReservation(
  supplierId: SupplierId,
  amount: number,
): Promise<boolean> {
  const rupiah = Math.round(Number(amount));
  if (!Number.isFinite(rupiah) || rupiah <= 0) return false;

  return (
    (await supabaseRpc<boolean>("release_supplier_reservation", {
      p_supplier_id: supplierId,
      p_amount: rupiah,
    })) === true
  );
}

/**
 * Saldo bebas seluruh supplier: `balance - reserved_balance`.
 *
 * Dipakai `pilihSupplier`. Ada di sini, bukan di `select.ts`, supaya
 * perhitungannya satu di seluruh aplikasi - kalau `select.ts` punya
 * rumus sendiri, checkout dan eksekusi bisa melihat angka berbeda.
 */
export async function loadAvailableBalances(): Promise<
  Array<{ supplierId: SupplierId; balance: number; reserved: number }>
> {
  const rows = await supabaseSelect<{
    supplier_id: string;
    balance: number | string;
    reserved_balance: number | string;
  }>("supplier_balances", {
    select: "supplier_id,balance,reserved_balance",
    limit: 500,
  });

  return rows.map((row) => ({
    supplierId: row.supplier_id,
    balance: Number(row.balance),
    reserved: Number(row.reserved_balance),
  }));
}

async function supplierExists(supplierId: SupplierId): Promise<boolean> {
  const rows = await supabaseSelect<{ id: string }>("suppliers", {
    select: "id",
    filters: { id: `eq.${supplierId}` },
    limit: 1,
  });
  return rows.length > 0;
}