-- ============================================================================
-- 055 - Backfill paid_at yang tersimpan sebagai jam WIB berlabel UTC (+7 jam)
--
-- BUG
--
-- Kolom paid_at (orders dan payments) diisi mentah dari waktu gateway:
-- Midtrans settlement_time / DOKU paidTime / Paylabs paidTime. Ketiganya
-- mengirim jam WIB TANPA offset ("2026-10-17 13:14:50"), dan nilai itu
-- disimpan apa adanya ke kolom timestamptz - jadi dibaca sebagai UTC.
-- Hasil: paid_at meleset +7 jam dari kenyataan.
--
-- Bukti kasus: order NBH-20261017-5F860649E9
--   created_at 06:14:18+00 (server, benar)
--   paid_at    13:14:50+00 (WIB 13:14:50 yang tersimpan sebagai UTC;
--              bayaran sebenarnya 06:14:50 UTC, 32 detik setelah order)
--
-- Kenapa baris yang salah bisa dikenali dengan presisi: order gateway
-- kedaluwarsa 30 menit setelah dibuat, jadi pembayaran sah TIDAK MUNGKIN
-- terjadi lebih dari ~31 menit setelah created_at. paid_at yang meleset
-- +7 jam selalu jatuh di luar jendela itu. Order merchant sengaja
-- dikecualikan (merchant_id is not null): scan kasir memang bisa terjadi
-- berjam-jam setelah order dibuat, dan paid_at mereka ditulis server
-- (sudah UTC yang benar).
--
-- Kode diperbaiki bersamaan (helper gatewayTimeToUtcIso); migrasi ini
-- membereskan data yang sudah terlanjur. Preseden backfill berjarak
-- sempit: 20261014_048_backfill_orders_paid_at.sql.
-- ============================================================================

update public.orders
   set paid_at = paid_at - interval '7 hours'
 where paid_at is not null
   and merchant_id is null
   and paid_at > created_at + interval '31 minutes';

update public.payments
   set paid_at = paid_at - interval '7 hours'
 where paid_at is not null
   and paid_at > created_at + interval '31 minutes';
