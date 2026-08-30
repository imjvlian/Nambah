-- 0.2.1 Digiflazz TEST integration.

create table if not exists public.supplier_webhook_events (
  id bigint generated always as identity primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  event_type text not null,
  request_ref text,
  status text,
  user_agent text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists supplier_webhook_events_lookup_idx
  on public.supplier_webhook_events(supplier_id, request_ref, received_at desc);

alter table public.supplier_webhook_events enable row level security;
revoke all on table public.supplier_webhook_events from anon, authenticated;
revoke usage, select on sequence public.supplier_webhook_events_id_seq from anon, authenticated;
