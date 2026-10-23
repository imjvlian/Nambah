-- ============================================================================
-- 061 - P3.1: maintenance mode per SKU / per game
--
-- Masalah (roadmap 3.1): katalog masih menampilkan produk yang tidak
-- bisa dibeli - pelanggan membayar dulu, baru ketahuan gagal saat
-- fulfillment, lalu masuk loop refund.
--
-- Desain (terpisah dari `active` dengan sengaja):
--   - `active`           dimiliki sinkronisasi katalog supplier (scan
--     bisa menonaktifkan produk yang hilang dari supplier) - memakai
--     flag yang sama untuk maintenance berarti pindah manual bisa
--     ditimpa scan berikutnya, atau sebaliknya.
--   - `maintenance`      dimiliki admin murni: sedang diperbaiki sementara,
--     akan kembali. Etalase menyembunyikan item yang maintenance, dan
--     checkout menolak dengan pesan jujur (pertahanan berlapis untuk
--     halaman yang masih kecache di browser pelanggan).
--
-- Game-level flag menutup SEMUA SKU game itu sekaligus - skenario
-- nyatanya "game X gangguan di supplier, matikan dulu semuanya" tanpa
-- men-toggle puluhan SKU satu per satu.
--
-- Idempoten. Cache katalog publik otomatis ter-invalidate lewat
-- noteCatalogWrite() karena tulisan lewat supabaseUpdate.
-- ============================================================================

alter table public.games
  add column if not exists maintenance boolean not null default false;

alter table public.products
  add column if not exists maintenance boolean not null default false;
