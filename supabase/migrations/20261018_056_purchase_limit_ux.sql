-- ============================================================================
-- 056 - UX item limited (0.9a): alasan limit di audit + cache purchase-limit
--
-- Dua hal sekaligus:
--
-- 1. orders.account_limit_reason — detail dari status `limit_blocked` yang
--    selama ini hanya hidup di response API: statusnya tercatat, alasannya
--    tidak. Sekarang diagnosa kasus seperti xeesoxee (17 Okt 2026) cukup
--    dari satu baris SQL: status + reason + nickname + provider.
--
-- 2. account_check_cache.purchase_limit — payload status WDP / Double
--    Diamonds dari POST /mobile-legends/purchase-limit. Tanpa kolom ini,
--    popup "paket ini sudah dibeli" harus memanggil Melostore setiap kali
--    pelanggan memilih paket — melanggar aturan RPM (40 cek gratis/hari,
--    dibagi dengan gate checkout). Dengan cache, popup membaca GRATIS;
--    datanya diisi maksimal sekali per 24 jam per akun oleh cek akun UI
--    maupun gate checkout, dan TTL-nya mengikuti baris cache induknya.
-- ============================================================================

alter table public.orders
  add column if not exists account_limit_reason text
    check (
      account_limit_reason is null
      or account_limit_reason in ('weekly-pass', 'double-diamonds')
    );

alter table public.account_check_cache
  add column if not exists purchase_limit jsonb;
