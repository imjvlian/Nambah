-- ============================================================================
-- 037 — merchant_balances.pending_commitment
-- ============================================================================
--
-- MIGRASI SUSULAN. File 036 sudah dijalankan di produksi sebelum kolom ini
-- ada, jadi `add column if not exists` di dalam 036 tidak pernah
-- mengeksekusinya. Kolom ini sekarang dipakai `syncMerchantBalance` dan
-- `checkMerchantCredit`, jadi tanpa migrasi ini dua fungsi itu gagal dengan
-- PGRST204 setiap kali dipanggil.
--
-- Ambang waktu untuk menambah kolom SELALU setelah migrasi yang membuatnya
-- dibutuhkan, bukan dimigration yang sama - kalau tidak, urutan eksekusi
-- file tidak pernah jadi masalah yang nyata.

alter table public.merchant_balances
  add column if not exists pending_commitment bigint not null default 0;

comment on column public.merchant_balances.pending_commitment is
  'Nilai order merchant yang sudah dibuat tapi belum discan merchant. '
  'Dipisah dari balance: balance adalah utang yang sudah jadi, sedangkan ini '
  'masih bisa batal. Tetap harus ikut dihitung saat cek kredit karena merchant '
  'boleh scan tanpa transfer, jadi begitu discan Lacte yang menanggung.';