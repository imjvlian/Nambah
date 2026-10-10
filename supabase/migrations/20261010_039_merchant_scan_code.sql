-- ============================================================================
-- 039 — orders.merchant_scan_code
-- ============================================================================
--
-- Kode pendek yang dipindai kasir di konter, menggantikan Order ID panjang
-- (`NBH-20261008-44BA21FB45`) sebagai token yang dibaca manusia.
--
-- kenapa KODE TERSENDIRI, bukan pakai Order ID:
--
-- Order ID mengandung tanggal dan 10 karakter acak. Satu karakter yang
-- tertukar saat dibaca kasir berarti "kode tidak ditemukan" - kasir
-- menyimpulkan ordernya tidak ada, padahal ada. Kode pendek dengan alfabet
-- Crockford (tanpa I/L/O/U) menghapus empat huruf yang paling sering tertukar
-- hanya dengan mengubah format.
--
-- NULLABLE dan index-nya PARSIAL. Order non-merchant tidak pernah punya kode
-- ini, dan `unique` penuh akan membuat semua NULL itu saling bertabrakan.
-- Pola partial index ini sama dengan `orders_pending_merchant_idx` di
-- migrasi 036.
--
-- Kolom ini dibuat hanya untuk order `merchant_retail`. Tidak ada reason
-- untuk memberi kode pada order Midtrans/DOKU - tidak ada yang memindainya.

alter table public.orders
  add column if not exists merchant_scan_code text;

create unique index if not exists orders_merchant_scan_code_idx
  on public.orders(merchant_scan_code)
  where merchant_scan_code is not null;

comment on column public.orders.merchant_scan_code is
  'Kode pendek untuk dipindai kasir (format MR7K-2X9Q, alfabet Crockford). '
  'Hanya diisi untuk order merchant_retail. Dibaca oleh '
  'src/lib/merchant-scan-code.ts.';