-- 026: Sesi pembayaran per gateway di baris payments.
--
-- payment_payload menyimpan data sesi gateway non-Midtrans (DOKU):
-- konten QRIS, referenceNo, validityPeriod, dan notifikasi mentah terakhir.
-- jsonb supaya bentuknya bisa berbeda per channel (qris/va/ewallet/...).

alter table public.payments
  add column if not exists payment_payload jsonb;

comment on column public.payments.payment_payload is
  'Sesi gateway non-Midtrans (DOKU): qrContent, referenceNo, expiresAt, lastNotification';
