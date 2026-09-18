-- Nambah database bootstrap schema.
-- This is intentionally a bootstrap file, not migration history.
-- Apply only to a dedicated Nambah Supabase project, verify it, then create
-- real migrations with the Supabase CLI once the project is linked locally.

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
  default_affiliate_rate numeric(10,6) not null default 0.20
    check (default_affiliate_rate >= 0 and default_affiliate_rate <= 1),
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

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'superadmin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_users_active_role_idx
  on public.admin_users(active, role);

create table if not exists public.affiliates (
  code text primary key,
  display_name text not null,
  commission_rate numeric(10,6) not null default 0.20
    check (commission_rate >= 0 and commission_rate <= 1),
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

create table if not exists public.supplier_balance_snapshots (
  id bigint generated always as identity primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  balance bigint not null check (balance >= 0),
  reserved_balance bigint not null default 0 check (reserved_balance >= 0),
  status text not null check (status in ('healthy', 'low', 'critical', 'unknown')),
  checked_at timestamptz not null default now(),
  check (reserved_balance <= balance)
);

create index if not exists supplier_balance_snapshots_lookup_idx
  on public.supplier_balance_snapshots(supplier_id, checked_at desc);

create table if not exists public.orders (
  id text primary key,
  customer_user_id uuid,
  receipt_email text,
  receipt_whatsapp text,
  game_id text not null references public.games(id),
  product_id text not null references public.products(id),
  payment_method_id text not null references public.payment_methods(id),
  target_user_id text not null,
  target_server_id text,
  promotion_code text references public.promotions(code),
  affiliate_code text references public.affiliates(code),
  supplier_id text references public.suppliers(id),
  status text not null default 'pending_payment' check (
    status in ('pending_payment', 'paid', 'processing', 'success', 'failed', 'refunded', 'cancelled')
  ),
  reference_price bigint not null check (reference_price >= 0),
  selling_price bigint not null check (selling_price >= 0),
  supplier_cost bigint not null check (supplier_cost >= 0),
  customer_payment_fee bigint not null default 0 check (customer_payment_fee >= 0),
  merchant_payment_cost bigint not null default 0 check (merchant_payment_cost >= 0),
  promotion_discount bigint not null default 0 check (promotion_discount >= 0),
  referral_discount bigint not null default 0 check (referral_discount >= 0),
  points_redeemed bigint not null default 0 check (points_redeemed >= 0),
  points_discount bigint not null default 0 check (points_discount >= 0),
  points_earned bigint not null default 0 check (points_earned >= 0),
  final_price bigint not null check (final_price >= 0),
  net_profit_before_affiliate bigint not null,
  affiliate_rate numeric(10,6) not null default 0 check (affiliate_rate >= 0 and affiliate_rate <= 1),
  affiliate_commission bigint not null default 0 check (affiliate_commission >= 0),
  nambah_profit bigint not null,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_status_created_idx on public.orders(status, created_at desc);
create index if not exists orders_affiliate_idx
  on public.orders(affiliate_code) where affiliate_code is not null;

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_transaction_id text,
  status text not null check (
    status in ('pending', 'settlement', 'capture', 'deny', 'cancel', 'expire', 'refund', 'failure')
  ),
  amount bigint not null check (amount >= 0),
  raw_status text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index if not exists payments_order_idx on public.payments(order_id, created_at desc);

create table if not exists public.supplier_transactions (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  supplier_id text not null references public.suppliers(id),
  product_id text not null references public.products(id),
  request_ref text not null,
  supplier_transaction_id text,
  supplier_sku text,
  target text not null,
  cost bigint not null check (cost >= 0),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  message text,
  serial_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, request_ref)
);

create index if not exists supplier_transactions_order_idx
  on public.supplier_transactions(order_id, created_at desc);

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

create table if not exists public.loyalty_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points_balance bigint not null default 0,
  reserved_points bigint not null default 0 check (reserved_points >= 0),
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0),
  lifetime_redeemed bigint not null default 0 check (lifetime_redeemed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.point_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text references public.orders(id) on delete set null,
  type text not null check (
    type in ('reserve','redeem','release','earn','refund','reversal','expire','admin_adjustment')
  ),
  points_delta bigint not null default 0,
  reserved_delta bigint not null default 0,
  balance_after bigint not null,
  reserved_after bigint not null check (reserved_after >= 0),
  idempotency_key text not null unique,
  note text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists point_ledger_user_created_idx
  on public.point_ledger(user_id, created_at desc);
create index if not exists point_ledger_order_idx
  on public.point_ledger(order_id, created_at desc)
  where order_id is not null;

create table if not exists public.commissions (
  id bigint generated always as identity primary key,
  affiliate_code text not null references public.affiliates(code),
  order_id text not null unique references public.orders(id) on delete cascade,
  base_profit bigint not null,
  rate numeric(10,6) not null check (rate >= 0 and rate <= 1),
  amount bigint not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'available', 'withdrawn', 'cancelled')),
  available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commissions_affiliate_status_idx
  on public.commissions(affiliate_code, status, created_at desc);

create table if not exists public.affiliate_withdrawals (
  id bigint generated always as identity primary key,
  affiliate_code text not null references public.affiliates(code),
  amount bigint not null check (amount > 0),
  method text not null,
  account_name text not null,
  account_number text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_withdrawals_lookup_idx
  on public.affiliate_withdrawals(affiliate_code, status, requested_at desc);

-- Defense in depth: every table in the exposed public schema has RLS enabled.
alter table public.games enable row level security;
alter table public.products enable row level security;
alter table public.payment_methods enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.promotions enable row level security;
alter table public.promotion_products enable row level security;
alter table public.admin_users enable row level security;
alter table public.affiliates enable row level security;
alter table public.supplier_balances enable row level security;
alter table public.supplier_balance_snapshots enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.supplier_transactions enable row level security;
alter table public.supplier_webhook_events enable row level security;
alter table public.receipt_deliveries enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.point_ledger enable row level security;
alter table public.commissions enable row level security;
alter table public.affiliate_withdrawals enable row level security;

-- 0.2.0 intentionally exposes no database table directly to browsers.
-- The Next.js server reads through SUPABASE_SECRET_KEY and returns sanitized data.
-- Customer/authenticated RLS policies will be added when Supabase Auth is introduced.
revoke all on table public.games from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.payment_methods from anon, authenticated;
revoke all on table public.suppliers from anon, authenticated;
revoke all on table public.supplier_products from anon, authenticated;
revoke all on table public.pricing_rules from anon, authenticated;
revoke all on table public.promotions from anon, authenticated;
revoke all on table public.promotion_products from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.affiliates from anon, authenticated;
revoke all on table public.supplier_balances from anon, authenticated;
revoke all on table public.supplier_balance_snapshots from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.supplier_transactions from anon, authenticated;
revoke all on table public.supplier_webhook_events from anon, authenticated;
revoke all on table public.receipt_deliveries from anon, authenticated;
revoke all on table public.loyalty_accounts from anon, authenticated;
revoke all on table public.point_ledger from anon, authenticated;
revoke all on table public.commissions from anon, authenticated;
revoke all on table public.affiliate_withdrawals from anon, authenticated;

revoke usage, select on all sequences in schema public from anon, authenticated;


-- Nambah Points atomic lifecycle functions.
create or replace function public.nambah_points_reserve(
  p_user_id uuid,
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_user uuid;
  v_points bigint;
  v_account public.loyalty_accounts%rowtype;
begin
  select customer_user_id, points_redeemed
    into v_order_user, v_points
  from public.orders
  where id = p_order_id;

  if v_order_user is null or v_order_user <> p_user_id then
    raise exception 'Order tidak dimiliki user Nambah yang valid.';
  end if;

  if coalesce(v_points, 0) <= 0 then
    return jsonb_build_object(
      'pointsBalance', 0,
      'reservedPoints', 0,
      'availablePoints', 0
    );
  end if;

  insert into public.loyalty_accounts(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
    into v_account
  from public.loyalty_accounts
  where user_id = p_user_id
  for update;

  if exists (
    select 1 from public.point_ledger
    where idempotency_key = 'reserve:' || p_order_id
  ) then
    return jsonb_build_object(
      'pointsBalance', v_account.points_balance,
      'reservedPoints', v_account.reserved_points,
      'availablePoints', v_account.points_balance - v_account.reserved_points
    );
  end if;

  if v_account.points_balance - v_account.reserved_points < v_points then
    raise exception 'Saldo Nambah Points tidak mencukupi.';
  end if;

  update public.loyalty_accounts
  set reserved_points = reserved_points + v_points,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_account;

  insert into public.point_ledger(
    user_id,
    order_id,
    type,
    points_delta,
    reserved_delta,
    balance_after,
    reserved_after,
    idempotency_key,
    note
  )
  values (
    p_user_id,
    p_order_id,
    'reserve',
    0,
    v_points,
    v_account.points_balance,
    v_account.reserved_points,
    'reserve:' || p_order_id,
    'Nambah Points reserved for checkout'
  );

  return jsonb_build_object(
    'pointsBalance', v_account.points_balance,
    'reservedPoints', v_account.reserved_points,
    'availablePoints', v_account.points_balance - v_account.reserved_points
  );
end;
$$;

create or replace function public.nambah_points_commit_redemption(
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_points bigint;
  v_account public.loyalty_accounts%rowtype;
begin
  select customer_user_id, points_redeemed
    into v_user, v_points
  from public.orders
  where id = p_order_id;

  if v_user is null or coalesce(v_points, 0) <= 0 then
    return '{}'::jsonb;
  end if;

  select *
    into v_account
  from public.loyalty_accounts
  where user_id = v_user
  for update;

  if not found then
    raise exception 'Loyalty account tidak ditemukan.';
  end if;

  if exists (
    select 1 from public.point_ledger
    where idempotency_key = 'redeem:' || p_order_id
  ) then
    return jsonb_build_object(
      'pointsBalance', v_account.points_balance,
      'reservedPoints', v_account.reserved_points,
      'availablePoints', v_account.points_balance - v_account.reserved_points
    );
  end if;

  if exists (
    select 1 from public.point_ledger
    where idempotency_key = 'restore:' || p_order_id
  ) then
    raise exception 'Reservation points order sudah dipulihkan.';
  end if;

  if v_account.reserved_points < v_points then
    raise exception 'Reservation Nambah Points tidak mencukupi.';
  end if;

  update public.loyalty_accounts
  set points_balance = points_balance - v_points,
      reserved_points = reserved_points - v_points,
      lifetime_redeemed = lifetime_redeemed + v_points,
      updated_at = now()
  where user_id = v_user
  returning * into v_account;

  insert into public.point_ledger(
    user_id,
    order_id,
    type,
    points_delta,
    reserved_delta,
    balance_after,
    reserved_after,
    idempotency_key,
    note
  )
  values (
    v_user,
    p_order_id,
    'redeem',
    -v_points,
    -v_points,
    v_account.points_balance,
    v_account.reserved_points,
    'redeem:' || p_order_id,
    'Nambah Points committed after payment verification'
  );

  return jsonb_build_object(
    'pointsBalance', v_account.points_balance,
    'reservedPoints', v_account.reserved_points,
    'availablePoints', v_account.points_balance - v_account.reserved_points
  );
end;
$$;

create or replace function public.nambah_points_restore_redemption(
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_points bigint;
  v_account public.loyalty_accounts%rowtype;
  v_committed boolean;
begin
  select customer_user_id, points_redeemed
    into v_user, v_points
  from public.orders
  where id = p_order_id;

  if v_user is null or coalesce(v_points, 0) <= 0 then
    return '{}'::jsonb;
  end if;

  select *
    into v_account
  from public.loyalty_accounts
  where user_id = v_user
  for update;

  if not found then
    return '{}'::jsonb;
  end if;

  if exists (
    select 1 from public.point_ledger
    where idempotency_key = 'restore:' || p_order_id
  ) then
    return jsonb_build_object(
      'pointsBalance', v_account.points_balance,
      'reservedPoints', v_account.reserved_points,
      'availablePoints', v_account.points_balance - v_account.reserved_points
    );
  end if;

  select exists (
    select 1 from public.point_ledger
    where idempotency_key = 'redeem:' || p_order_id
  ) into v_committed;

  if v_committed then
    update public.loyalty_accounts
    set points_balance = points_balance + v_points,
        updated_at = now()
    where user_id = v_user
    returning * into v_account;

    insert into public.point_ledger(
      user_id,
      order_id,
      type,
      points_delta,
      reserved_delta,
      balance_after,
      reserved_after,
      idempotency_key,
      note
    )
    values (
      v_user,
      p_order_id,
      'refund',
      v_points,
      0,
      v_account.points_balance,
      v_account.reserved_points,
      'restore:' || p_order_id,
      'Redeemed Nambah Points returned after terminal failure/refund'
    );
  elsif exists (
    select 1 from public.point_ledger
    where idempotency_key = 'reserve:' || p_order_id
  ) then
    update public.loyalty_accounts
    set reserved_points = greatest(0, reserved_points - v_points),
        updated_at = now()
    where user_id = v_user
    returning * into v_account;

    insert into public.point_ledger(
      user_id,
      order_id,
      type,
      points_delta,
      reserved_delta,
      balance_after,
      reserved_after,
      idempotency_key,
      note
    )
    values (
      v_user,
      p_order_id,
      'release',
      0,
      -v_points,
      v_account.points_balance,
      v_account.reserved_points,
      'restore:' || p_order_id,
      'Nambah Points reservation released'
    );
  else
    return jsonb_build_object(
      'pointsBalance', v_account.points_balance,
      'reservedPoints', v_account.reserved_points,
      'availablePoints', v_account.points_balance - v_account.reserved_points
    );
  end if;

  return jsonb_build_object(
    'pointsBalance', v_account.points_balance,
    'reservedPoints', v_account.reserved_points,
    'availablePoints', v_account.points_balance - v_account.reserved_points
  );
end;
$$;

create or replace function public.nambah_points_earn(
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_points bigint;
  v_status text;
  v_account public.loyalty_accounts%rowtype;
begin
  select customer_user_id, points_earned, status
    into v_user, v_points, v_status
  from public.orders
  where id = p_order_id;

  if v_user is null or coalesce(v_points, 0) <= 0 then
    return '{}'::jsonb;
  end if;

  if v_status <> 'success' then
    raise exception 'Points hanya dapat diberikan untuk order success.';
  end if;

  insert into public.loyalty_accounts(user_id)
  values (v_user)
  on conflict (user_id) do nothing;

  select *
    into v_account
  from public.loyalty_accounts
  where user_id = v_user
  for update;

  if exists (
    select 1 from public.point_ledger
    where idempotency_key = 'earn:' || p_order_id
  ) then
    return jsonb_build_object(
      'pointsBalance', v_account.points_balance,
      'reservedPoints', v_account.reserved_points,
      'availablePoints', v_account.points_balance - v_account.reserved_points
    );
  end if;

  update public.loyalty_accounts
  set points_balance = points_balance + v_points,
      lifetime_earned = lifetime_earned + v_points,
      updated_at = now()
  where user_id = v_user
  returning * into v_account;

  insert into public.point_ledger(
    user_id,
    order_id,
    type,
    points_delta,
    reserved_delta,
    balance_after,
    reserved_after,
    idempotency_key,
    note,
    expires_at
  )
  values (
    v_user,
    p_order_id,
    'earn',
    v_points,
    0,
    v_account.points_balance,
    v_account.reserved_points,
    'earn:' || p_order_id,
    'Nambah Points earned from successful transaction',
    now() + interval '12 months'
  );

  return jsonb_build_object(
    'pointsBalance', v_account.points_balance,
    'reservedPoints', v_account.reserved_points,
    'availablePoints', v_account.points_balance - v_account.reserved_points
  );
end;
$$;

create or replace function public.nambah_points_reverse_earn(
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_points bigint;
  v_account public.loyalty_accounts%rowtype;
begin
  select customer_user_id, points_earned
    into v_user, v_points
  from public.orders
  where id = p_order_id;

  if v_user is null or coalesce(v_points, 0) <= 0 then
    return '{}'::jsonb;
  end if;

  select *
    into v_account
  from public.loyalty_accounts
  where user_id = v_user
  for update;

  if not found then
    return '{}'::jsonb;
  end if;

  if not exists (
    select 1 from public.point_ledger
    where idempotency_key = 'earn:' || p_order_id
  ) or exists (
    select 1 from public.point_ledger
    where idempotency_key = 'reverse-earn:' || p_order_id
  ) then
    return jsonb_build_object(
      'pointsBalance', v_account.points_balance,
      'reservedPoints', v_account.reserved_points,
      'availablePoints', v_account.points_balance - v_account.reserved_points
    );
  end if;

  -- Negative balance is intentionally allowed after a refund if earned points
  -- were already spent. Future earnings repay the loyalty debt before the user
  -- has redeemable points again.
  update public.loyalty_accounts
  set points_balance = points_balance - v_points,
      updated_at = now()
  where user_id = v_user
  returning * into v_account;

  insert into public.point_ledger(
    user_id,
    order_id,
    type,
    points_delta,
    reserved_delta,
    balance_after,
    reserved_after,
    idempotency_key,
    note
  )
  values (
    v_user,
    p_order_id,
    'reversal',
    -v_points,
    0,
    v_account.points_balance,
    v_account.reserved_points,
    'reverse-earn:' || p_order_id,
    'Earned Nambah Points reversed after refund/failure'
  );

  return jsonb_build_object(
    'pointsBalance', v_account.points_balance,
    'reservedPoints', v_account.reserved_points,
    'availablePoints', v_account.points_balance - v_account.reserved_points
  );
end;
$$;

revoke all on function public.nambah_points_reserve(uuid, text) from public, anon, authenticated;
revoke all on function public.nambah_points_commit_redemption(text) from public, anon, authenticated;
revoke all on function public.nambah_points_restore_redemption(text) from public, anon, authenticated;
revoke all on function public.nambah_points_earn(text) from public, anon, authenticated;
revoke all on function public.nambah_points_reverse_earn(text) from public, anon, authenticated;

grant execute on function public.nambah_points_reserve(uuid, text) to service_role;
grant execute on function public.nambah_points_commit_redemption(text) to service_role;
grant execute on function public.nambah_points_restore_redemption(text) to service_role;
grant execute on function public.nambah_points_earn(text) to service_role;
grant execute on function public.nambah_points_reverse_earn(text) to service_role;

comment on table public.loyalty_accounts is
  'Server-owned Nambah Points aggregate balance. Available points = points_balance - reserved_points.';
comment on table public.point_ledger is
  'Immutable idempotent Nambah Points audit ledger.';

