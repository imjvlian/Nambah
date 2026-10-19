-- ============================================================================
-- 057 - Idempotensi checkout: kunci unik per rangkaian attempt (P1.5)
--
-- MASALAH
--
-- POST /api/orders tidak punya idempotensi. Tiga jendela nyata membuat
-- order ganda (dan tagihan ganda):
--   1. klik ganda dalam satu frame - guard state React baru efektif
--      setelah render berikutnya;
--   2. retry jaringan pada koneksi flaky;
--   3. respons hilang di jalan ketika order ternyata berhasil dibuat
--      (timeout client, sukses server) - pelanggan mencoba lagi dan
--      mendapat order KEDUA yang sama-sama menunggu dibayar.
--
-- Konsekuensi per order ganda: dua sesi pembayaran aktif (bisa dua-duanya
-- dibayar), reservasi Lacte Points / promo / saldo supplier terjadi dobel.
--
-- SOLUSI
--
-- Browser mengirim `idempotencyKey` (UUID) per isi form checkout. Kolom
-- ini menyimpannya dengan UNIQUE index sebagai penghakim terakhir:
--   - pre-check: kunci yang sudah dipakai order hidup (pending_payment /
--     pending_merchant) dijawab ulang dengan order itu;
--   - order lama yang sudah mati melepas kuncinya (NULL) supaya attempt
--     baru boleh memakai kunci yang sama;
--   - dua POST bersamaan yang lolos pre-check: insert pertama menang,
--     insert kedua kena unique index dan diarahkan ke pemenang.
--
-- UNIQUE index pada kolom nullable membolehkan banyak NULL - semua order
-- lama tetap sah tanpa backfill.
-- ============================================================================

alter table public.orders
  add column if not exists checkout_key text;

create unique index if not exists orders_checkout_key_uidx
  on public.orders(checkout_key);
