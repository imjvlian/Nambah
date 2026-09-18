-- Nambah 0.4.9 — transactional receipt delivery tracking.
-- Brevo is used only for email. The channel shape intentionally leaves room
-- for a future official WhatsApp provider without changing order schema.

create table if not exists public.receipt_deliveries (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  recipient text not null,
  provider text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  provider_message_id text,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, channel)
);

create index if not exists receipt_deliveries_status_idx
  on public.receipt_deliveries(status, updated_at desc);

alter table public.receipt_deliveries enable row level security;
revoke all on table public.receipt_deliveries from anon, authenticated;

comment on table public.receipt_deliveries is
  'Server-only idempotency and delivery log for order receipts.';
