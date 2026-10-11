-- ============================================================================
-- 042 - dedup webhook Melostore
-- ============================================================================
--
-- MIGRASI SUSULAN. File 041 sudah dijalankan di produksi sebelum kolom ini
-- ada, jadi route `/api/h2h-webhook` akan mendapat PGRST427 dari
-- PostgREST pada callback pertama yang masuk: kolom `event_key` tidak ada
-- di tabel yang di-`insert` ke.
--
-- Gejalanya modal sekali akan terlihat salah: Melostore mencatat
-- `webhook_delivery_status: failed`, dan operator mengira problem-nya di
-- Lacte padahal kredensialnya benar.
--
-- KENAPA KOLOM INI DIPERLUKAN
--
-- Melostore mengirim ulang callback. Tanpa kunci unik di database, satu
-- callback yang terkirim dua kali akan diproses dua kali - dan karena
-- efeknya menyentuh status order DAN saldo supplier, itu berarti pengurangan
-- saldo dua kali untuk satu top up.
--
-- `null` diijarkan karena tabel ini juga dipakai Digiflazz, yang belum
-- punya kunci event. Partial unique index mengabaikan baris null, jadi
-- kedua supplier bisa hidup berdampingan.

alter table public.supplier_webhook_events
  add column if not exists event_key text;

comment on column public.supplier_webhook_events.event_key is
  'Kunci idempotensi callback. Melostore: buyer_trx_id:status untuk hasil '
  'akhir, action:event_id:version untuk event tindakan. NULL untuk supplier '
  'yang belum punya kunci - lihat unique index partial di bawah.';

-- UNIQUE, BUKAN INDEX BIASA
--
-- Index biasa tidak mencegah apa pun. Yang mencegah pemrosesan ganda
-- adalah constraint: insert kedua dengan kunci sama akan gagal, dan
-- route bisa membalas "sudah diproses" alih-alih menerapkan efeknya lagi.
--
-- Partial (where event_key is not null) supaya baris tanpa kunci - semua
-- callback Digiflazz - tidak saling bertabrakan di index yang sama.
create unique index if not exists supplier_webhook_events_event_key_idx
  on public.supplier_webhook_events (event_key)
  where event_key is not null;

-- Pencarian by ref dipakai saat menelusuri riwayat callback di admin.
create index if not exists supplier_webhook_events_request_ref_idx
  on public.supplier_webhook_events (supplier_id, request_ref, received_at desc);