-- Nambah 0.4.17 — affiliate commission lifecycle.

create table if not exists public.affiliates (
  code text primary key,
  display_name text not null,
  commission_rate numeric(10,6) not null default 0.20
    check (commission_rate >= 0 and commission_rate <= 1),
  user_benefit_type text not null check (user_benefit_type in ('flat','percentage')),
  user_benefit_value numeric(14,4) not null check (user_benefit_value >= 0),
  minimum_order bigint not null default 0 check (minimum_order >= 0),
  max_user_benefit bigint check (max_user_benefit is null or max_user_benefit >= 0),
  stackable_with_promotions boolean not null default true,
  status text not null default 'active'
    check (status in ('active','inactive','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commissions (
  id bigint generated always as identity primary key,
  affiliate_code text not null references public.affiliates(code),
  order_id text not null unique references public.orders(id) on delete cascade,
  base_profit bigint not null,
  rate numeric(10,6) not null check (rate >= 0 and rate <= 1),
  amount bigint not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending','available','withdrawn','cancelled')),
  available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commissions_affiliate_status_idx
  on public.commissions(affiliate_code,status,created_at desc);

create table if not exists public.affiliate_withdrawals (
  id bigint generated always as identity primary key,
  affiliate_code text not null references public.affiliates(code),
  amount bigint not null check (amount > 0),
  method text not null,
  account_name text not null,
  account_number text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','paid','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_withdrawals_lookup_idx
  on public.affiliate_withdrawals(affiliate_code,status,requested_at desc);

alter table public.affiliates enable row level security;
alter table public.commissions enable row level security;
alter table public.affiliate_withdrawals enable row level security;

revoke all on table public.affiliates from anon, authenticated;
revoke all on table public.commissions from anon, authenticated;
revoke all on table public.affiliate_withdrawals from anon, authenticated;
revoke usage, select on all sequences in schema public from anon, authenticated;
