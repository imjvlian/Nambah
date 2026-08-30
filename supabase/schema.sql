-- Nambah database bootstrap schema.
-- This is intentionally a bootstrap file, not a migration history entry.
-- Once a dedicated Nambah Supabase project exists, apply this schema there,
-- verify it, then generate the first real migration from the project state.

create table if not exists public.games (
  id text primary key,
  name text not null,
  short_name text not null,
  category text not null check (category in ('game', 'voucher')),
  accent text not null,
  initials text not null,
  requires_server boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  game_id text not null references public.games(id) on delete cascade,
  label text not null,
  note text,
  selling_price bigint not null check (selling_price >= 0),
  reference_price bigint not null check (reference_price >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_game_id_idx on public.products(game_id);
create index if not exists products_active_sort_idx on public.products(active, sort_order);

create table if not exists public.payment_methods (
  id text primary key,
  name text not null,
  detail text not null,
  customer_fee_flat bigint not null default 0 check (customer_fee_flat >= 0),
  customer_fee_percent numeric(10,4) not null default 0 check (customer_fee_percent >= 0),
  merchant_fee_flat bigint not null default 0 check (merchant_fee_flat >= 0),
  merchant_fee_percent numeric(10,4) not null default 0 check (merchant_fee_percent >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_products (
  id bigint generated always as identity primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  supplier_sku text,
  supplier_cost bigint not null check (supplier_cost >= 0),
  active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, product_id)
);

create index if not exists supplier_products_product_idx on public.supplier_products(product_id);
create unique index if not exists supplier_products_supplier_sku_unique
  on public.supplier_products(supplier_id, supplier_sku)
  where supplier_sku is not null;

create table if not exists public.pricing_rules (
  id text primary key,
  minimum_nambah_profit bigint not null default 500 check (minimum_nambah_profit >= 0),
  default_affiliate_rate numeric(10,6) not null default 0.20 check (default_affiliate_rate >= 0 and default_affiliate_rate <= 1),
  target_supplier_balance bigint not null default 500000 check (target_supplier_balance >= 0),
  low_supplier_balance bigint not null default 100000 check (low_supplier_balance >= 0),
  critical_supplier_balance bigint not null default 50000 check (critical_supplier_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (critical_supplier_balance <= low_supplier_balance),
  check (low_supplier_balance <= target_supplier_balance)
);

create table if not exists public.promotions (
  code text primary key,
  name text not null,
  type text not null check (type in ('flat', 'percentage')),
  value numeric(14,4) not null check (value >= 0),
  minimum_order bigint not null default 0 check (minimum_order >= 0),
  max_discount bigint check (max_discount is null or max_discount >= 0),
  stackable_with_referral boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  quota integer check (quota is null or quota >= 0),
  quota_per_user integer check (quota_per_user is null or quota_per_user >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.promotion_products (
  promotion_code text not null references public.promotions(code) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  primary key (promotion_code, product_id)
);

create table if not exists public.affiliates (
  code text primary key,
  display_name text not null,
  commission_rate numeric(10,6) not null default 0.20 check (commission_rate >= 0 and commission_rate <= 1),
  user_benefit_type text not null check (user_benefit_type in ('flat', 'percentage')),
  user_benefit_value numeric(14,4) not null check (user_benefit_value >= 0),
  minimum_order bigint not null default 0 check (minimum_order >= 0),
  max_user_benefit bigint check (max_user_benefit is null or max_user_benefit >= 0),
  stackable_with_promotions boolean not null default true,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_balances (
  supplier_id text primary key references public.suppliers(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  reserved_balance bigint not null default 0 check (reserved_balance >= 0),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reserved_balance <= balance)
);

create table if not exists public.orders (
  id text primary key,
  customer_user_id uuid,
  game_id text not null references public.games(id),
  product_id text not null references public.products(id),
  payment_method_id text not null references public.payment_methods(id),
  target_user_id text not null,
  target_server_id text,
  promotion_code text references public.promotions(code),
  affiliate_code text references public.affiliates(code),
  status text not null default 'pending_payment' check (
    status in ('pending_payment', 'paid', 'processing', 'success', 'failed', 'refunded', 'cancelled')
  ),
  supplier_id text references public.suppliers(id),
  supplier_reference text,
  selling_price bigint not null check (selling_price >= 0),
  supplier_cost bigint not null check (supplier_cost >= 0),
  payment_fee bigint not null default 0 check (payment_fee >= 0),
  promotion_discount bigint not null default 0 check (promotion_discount >= 0),
  referral_discount bigint not null default 0 check (referral_discount >= 0),
  final_price bigint not null check (final_price >= 0),
  net_profit bigint not null,
  affiliate_rate numeric(10,6) not null default 0 check (affiliate_rate >= 0 and affiliate_rate <= 1),
  affiliate_commission bigint not null default 0 check (affiliate_commission >= 0),
  nambah_profit bigint not null,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_status_created_idx on public.orders(status, created_at desc);
create index if not exists orders_affiliate_idx on public.orders(affiliate_code) where affiliate_code is not null;

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_transaction_id text,
  status text not null check (status in ('pending', 'settlement', 'capture', 'deny', 'cancel', 'expire', 'refund', 'failure')),
  amount bigint not null check (amount >= 0),
  raw_status text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create table if not exists public.commissions (
  id bigint generated always as identity primary key,
  affiliate_code text not null references public.affiliates(code),
  order_id text not null unique references public.orders(id) on delete cascade,
  base_profit bigint not null,
  rate numeric(10,6) not null check (rate >= 0 and rate <= 1),
  amount bigint not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'available', 'withdrawn', 'cancelled')),
  available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS is enabled on every table in the exposed public schema.
alter table public.games enable row level security;
alter table public.products enable row level security;
alter table public.payment_methods enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.promotions enable row level security;
alter table public.promotion_products enable row level security;
alter table public.affiliates enable row level security;
alter table public.supplier_balances enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.commissions enable row level security;

-- Explicit least-privilege Data API grants. Public clients only need the three
-- customer-safe catalog tables. All pricing/supplier/order data stays server-only.
revoke all on table public.games from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.payment_methods from anon, authenticated;
revoke all on table public.suppliers from anon, authenticated;
revoke all on table public.supplier_products from anon, authenticated;
revoke all on table public.pricing_rules from anon, authenticated;
revoke all on table public.promotions from anon, authenticated;
revoke all on table public.promotion_products from anon, authenticated;
revoke all on table public.affiliates from anon, authenticated;
revoke all on table public.supplier_balances from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.commissions from anon, authenticated;

grant select on table public.games to anon, authenticated;
grant select on table public.products to anon, authenticated;
grant select on table public.payment_methods to anon, authenticated;

drop policy if exists "public can read active games" on public.games;
create policy "public can read active games"
on public.games for select
to anon, authenticated
using (active = true);

drop policy if exists "public can read active products" on public.products;
create policy "public can read active products"
on public.products for select
to anon, authenticated
using (active = true);

drop policy if exists "public can read active payment methods" on public.payment_methods;
create policy "public can read active payment methods"
on public.payment_methods for select
to anon, authenticated
using (active = true);
