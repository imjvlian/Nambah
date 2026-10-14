-- ============================================================================
-- 048 - Backfill orders.paid_at untuk order ritel yang sudah dibayar.
--
-- MASALAH
--
-- Kartu "Omzet hari ini" dan laporan Arus Kas menghitung order per `paid_at`,
-- bukan per `created_at`. Order ritel dibayar di toko, jadi tidak ada webhook
-- gateway yang mengisinya - `paid_at`-nya null. Efeknya: semua order ritel
-- hilang dari laporan omzet, dan angka yang tampil terlihat seperti hari biasa
-- tanpa penjualan toko.
--
-- MENGAPA BACKFILL, BUKAN MIGRASI KOSONG
--
-- Baris yang sudah ada tidak akan pernah diperbaiki oleh kode: `paid_at`
-- hanya diisi saat status berubah, dan order lama sudah lewat. Kalau tidak
-- di-backfill, order ritel yang sudah sukses SELAMANYA tidak masuk laporan.
--
-- SUMBER TANGGAL
--
-- Dipakai `status_changed_at` kalau ada, karena itu momen status jadi 'paid'
-- (kasir memindai). `created_at` hanya cadangan untuk baris lama yang
-- `status_changed_at`-nya juga kosong. Order yang belum pernah dibayar
-- (pending_payment, failed, cancelled) sengaja TIDAK disentuh - mengisi
-- `paid_at` untuk order yang belum dibayar akan menjadi pemalsuan.
--
-- HANYA STATUS YANG ARTINYA UANG SUDAH MASUK
--
-- Filter di bawah sengaja tidak memakai `in.('paid','processing','success')`
-- longgar. Kalau sebuah order sukses lalu di-refund, `paid_at`-nya harus tetap
-- ada - refund adalah arus kas keluar yang tercatat terpisah, bukan alasan
-- untuk menghapus jejak pembayarannya. Hanya order yang belum pernah dibayar
-- yang tidak boleh punya `paid_at`.
--
-- INDEX
--
-- Kolom ini sekarang jadi titik hitung utama laporan harian, sehingga perlu
-- index. Tanpa, kartu ringkasan memindai seluruh tabel order
-- setiap kali dashboard dibuka.
-- ============================================================================

-- 1. Backfill.
update public.orders o
set paid_at = coalesce(
      o.status_changed_at,
      o.updated_at,
      o.created_at
    )
where o.paid_at is null
  and o.status in ('paid', 'processing', 'success');

-- 2. Index untuk rentang tanggal per hari.
create index if not exists idx_orders_paid_at
  on public.orders(paid_at)
  where paid_at is not null;

comment on column public.orders.paid_at is
  'Waktu pembayaran benar-benar masuk. Diisi dari settlement_time gateway '
  'untuk order online, dari saat kasir memindai untuk order ritel, dan '
  'di-backfill dari status_changed_at untuk order lama (migration 048). '
  'Titik hitung semua laporan omzet harian.';