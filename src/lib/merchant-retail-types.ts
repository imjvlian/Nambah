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

export type MerchantStatus = "active" | "frozen" | "inactive";