-- 025: Multi payment gateway (Midtrans ⇄ DOKU) — fondasi switch provider.
--
-- - orders.payment_provider: gateway yang membuat sesi pembayaran order
--   tersebut. Order lama otomatis 'midtrans' (zero behavior change).
-- - orders.payment_payload: sesi pembayaran per provider (snap token,
--   konten QR DOKU, nomor VA, deeplink e-wallet, expiry, dst).
-- - app_settings: key-value internal (service role only) untuk konfigurasi
--   runtime yang bisa diubah dari dashboard — termasuk gateway aktif.
--
-- Semantik switch: hanya memengaruhi ORDER BARU. Order yang sedang berjalan
-- tetap diproses oleh provider pembuatnya (webhook & status-check membaca
-- orders.payment_provider, bukan setting global).

alter table public.orders
  add column if not exists payment_provider text not null default 'midtrans';

alter table public.orders
  add column if not exists payment_payload jsonb;

create index if not exists orders_payment_provider_status_idx
  on public.orders(payment_provider, status);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Tidak ada policy untuk anon/authenticated: tabel ini hanya boleh diakses
-- lewat service key (API route server). Semua baca/tulis lewat admin API.

insert into public.app_settings (key, value)
values ('active_payment_provider', '"midtrans"')
on conflict (key) do nothing;
