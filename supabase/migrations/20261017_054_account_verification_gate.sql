-- ============================================================================
-- 054 - Account verification gate: jejak audit di orders + cache Melostore
--
-- PEMICU
--
-- DOKU menolak pengajuan merchant karena transaksi Top Up Game masih bisa
-- diproses meskipun User ID Game yang dimasukkan tidak valid. Gate
-- verifikasi akun di `POST /api/orders` adalah kontrol yang diminta; lima
-- kolom ini adalah BUKTINYA: setiap order kini mencatat hasil verifikasi,
-- provider yang dipakai, nickname yang ditemukan, dan waktunya.
--
-- Untuk Melostore ada juga `billing.transaction_id` di sisi supplier —
-- bukti dari pihak ketiga, bukan catatan di database sendiri.
--
-- STATUS YANG DICATAT
--
-- verified        — akun ditemukan (baru saja dicek, atau cache hit dari
--                   gate/route check: provider kolom bisa melostore,
--                   volsever, atau mimih).
-- invalid         — provider menyatakan akun tidak ada.
-- unavailable     — provider gangguan/rate limit/saldo habis. Reason
--                   detailnya tidak disimpan di kolom supaya tabel tetap
--                   kecil — log server punya konteksnya.
-- not_required    — game tidak punya checker (voucher/pulsa), game residual
--                   yang diterima tertulis, atau pemetaan belum tersedia
--                   (fail-open + alarm readiness).
-- not_configured  — kredensial Melostore belum diisi. Fail-open sesuai
--                   keputusan: satu env kosong tidak boleh mematikan
--                   seluruh game. Readiness menandainya warning.
-- limit_blocked   — khusus MLBB: weekly pass limit reached atau belum
--                   eligible double diamonds.
-- skipped         — mode gate `off`: tidak ada evaluasi sama sekali.
-- ============================================================================

alter table public.orders
  add column if not exists account_verification_status text
    check (account_verification_status in (
      'verified', 'invalid', 'unavailable',
      'not_required', 'not_configured', 'limit_blocked', 'skipped'
    )),
  add column if not exists account_check_provider text
    check (
      account_check_provider is null
      or account_check_provider in ('melostore', 'volsever', 'mimih')
    ),
  add column if not exists account_nickname text,
  add column if not exists account_region text,
  add column if not exists account_verified_at timestamptz;

create index if not exists orders_account_verification_idx
  on public.orders(account_verification_status, created_at desc);

-- ============================================================================
-- Cache cek akun: provider baru.
--
-- `account_check_cache.provider` awalnya hanya volsever + mimih (route
-- cek akun lama di UI). Gate checkout memakai Melostore, dan hasil
-- suksesnya masuk cache yang sama supaya:
--   1. cek dari UI (gratis) menghangatkan cache untuk checkout, dan
--   2. cek dari checkout menghangatkan cache untuk UI.
-- Satu pasangan game:id:zone hanya sekali bayar per 24 jam di Melostore.
-- ============================================================================

alter table public.account_check_cache
  drop constraint if exists account_check_cache_provider_check;

alter table public.account_check_cache
  add constraint account_check_cache_provider_check
    check (provider in ('volsever', 'mimih', 'melostore'));
