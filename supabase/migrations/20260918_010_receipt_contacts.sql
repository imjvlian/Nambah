-- Nambah 0.4.7 — receipt contact capture.
-- Guest checkout requires both fields in application validation. Logged-in
-- orders derive receipt_email from Supabase Auth and may leave WhatsApp null
-- until account profile contact data is introduced.

alter table public.orders
  add column if not exists receipt_email text,
  add column if not exists receipt_whatsapp text;

comment on column public.orders.receipt_email is
  'Receipt destination email. Guest checkout provides it explicitly; signed-in checkout derives it from Supabase Auth.';

comment on column public.orders.receipt_whatsapp is
  'Normalized WhatsApp receipt destination in E.164-style format when supplied.';
