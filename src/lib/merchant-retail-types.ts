/**
 * Tipe yang dipakai bersama oleh modul aturan dan modul server-side
 * program merchant ritel.
 *
 * Dipisah supaya `merchant-retail-rules.ts` (yang murni dan bisa diuji)
 * TIDAK perlu mengimpor `merchant-retail.ts` — modul itu mengimpor
 * `server-only` dan menarik Supabase, yang tidak ada di test runner.
 *
 * File ini tidak boleh berisi apa pun selain tipe: kalau ada nilai runtime
 * di sini, urutan import antara kedua modul bisa membuat cycle.
 */

/**
 * Status merchant.
 *
 * `pending` = mendaftar sendiri, menunggu persetujuan admin. Toko dalam
 * status ini tidak bisa muncul di checkout, tidak bisa memindai pesanan,
 * dan tidak bisa punya piutang. Hanya admin yang bisa mengaktifkannya lewat
 * `PATCH /api/admin/merchants`.
 */
export type MerchantStatus = "pending" | "active" | "frozen" | "inactive";