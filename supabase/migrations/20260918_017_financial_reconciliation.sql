-- Nambah 0.4.23 — financial reconciliation snapshots.
-- Detection only: this table never moves money or changes provider truth.

create table if not exists public.financial_reconciliations (
  order_id text primary key references public.orders(id) on delete cascade,
  result text not null check (result in ('ok','warning','error')),
  issues jsonb not null default '[]'::jsonb,
  expected jsonb not null default '{}'::jsonb,
  actual jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_reconciliations_result_idx
  on public.financial_reconciliations(result, checked_at desc);

alter table public.financial_reconciliations enable row level security;
revoke all on table public.financial_reconciliations from anon, authenticated;
