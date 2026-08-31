-- 0.3.0 — Midtrans Sandbox payment foundation.
-- Run after 0.2.3 migration.

alter table public.payments
  add column if not exists snap_token text,
  add column if not exists redirect_url text,
  add column if not exists payment_type text,
  add column if not exists fraud_status text,
  add column if not exists signature_verified_at timestamptz;

create unique index if not exists payments_order_provider_unique
  on public.payments(order_id, provider);

create table if not exists public.midtrans_payment_events (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  transaction_id text,
  transaction_status text not null,
  status_code text,
  gross_amount text,
  payment_type text,
  fraud_status text,
  source text not null check (source in ('webhook', 'status_api')),
  signature_verified boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists midtrans_payment_events_order_idx
  on public.midtrans_payment_events(order_id, received_at desc);

create index if not exists midtrans_payment_events_transaction_idx
  on public.midtrans_payment_events(transaction_id, received_at desc)
  where transaction_id is not null;

alter table public.midtrans_payment_events enable row level security;
revoke all on table public.midtrans_payment_events from anon, authenticated;
revoke usage, select on sequence public.midtrans_payment_events_id_seq from anon, authenticated;
