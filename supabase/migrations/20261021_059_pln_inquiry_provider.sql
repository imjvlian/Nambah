-- ============================================================================
-- 059 - P1.6: provider verifikasi digiflazz (inquiry PLN)
--
-- Gerbang verifikasi kini juga memakai Digiflazz sebagai penyedia cek
-- (inquiry PLN: nomor pelanggan / ID meter dicek nama pelanggannya,
-- bebas biaya, tanpa transaksi). Kolom audit orders.account_check_provider
-- perlu menerima nilai 'digiflazz'.
--
-- Cache account_check_cache TIDAK tersentuh: jalur e-wallet menulis
-- provider 'melostore' (cek via Melostore), dan inquiry PLN tidak
-- menulis cache (gratis, langsung tiap kali).
-- ============================================================================

alter table public.orders
  drop constraint if exists orders_account_check_provider_check;

alter table public.orders
  add constraint orders_account_check_provider_check
  check (
    account_check_provider is null
    or account_check_provider in ('melostore', 'volsever', 'mimih', 'digiflazz')
  );
