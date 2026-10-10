-- ============================================================================
-- 038 — merchants.pin_hash
-- ============================================================================
--
-- Autentikasi kasir memakai `code` + `pin`, bukan sesi Supabase. Alasannya
-- operasional: kasir berada di konter dengan satu perangkat yang sering
-- berganti dan tidak punya email, sehingga login berbasis akun akan jadi
-- langkah yang dilewati setiap kali ada shift.
--
-- Yang disimpan hanya hash-nya. Format `scrypt$N$r$p$salt$hash` menyimpan
-- parameter algoritma di dalam string yang disimpan, jadi hash lama tetap
-- bisa diverifikasi kalau nanti parameter-nya dinaikkan tanpa migrasi data.
--
-- NULL berarti merchant belum punya PIN dan TIDAK bisa memindai pesanan.
-- Sengaja begitu: merchant yang dibuat admin tapi belum dikasih PIN harus
-- gagal dengan jelas, bukan diam-diam punya akses kosong.

alter table public.merchants
  add column if not exists pin_hash text;

comment on column public.merchants.pin_hash is
  'Hash PIN kasir (scrypt$N$r$p$salt$hash). NULL = merchant belum punya PIN '
  'dan tidak bisa memindai pesanan. Authenticate lewat resolveMerchantForCode '
  'di src/lib/merchant-auth.ts.';

-- Route ini mencari merchant lewat `code` untuk mencari merchant. `code` sudah punya unique
-- index dari migrasi 036, jadi tidak perlu index tambahan di sini.