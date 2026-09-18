-- Nambah 0.4.14 — Nambah Points loyalty foundation.
-- Server-only ledger + atomic RPC functions. Browsers never mutate points tables directly.

alter table public.orders
  add column if not exists points_redeemed bigint not null default 0 check (points_redeemed >= 0),
  add column if not exists points_discount bigint not null default 0 check (points_discount >= 0),
  add column if not exists points_earned bigint not null default 0 check (points_earned >= 0);

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
    type in (
      'reserve',
      'redeem',
      'release',
      'earn',
      'refund',
      'reversal',
      'expire',
      'admin_adjustment'
    )
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

alter table public.loyalty_accounts enable row level security;
alter table public.point_ledger enable row level security;
revoke all on table public.loyalty_accounts from anon, authenticated;
revoke all on table public.point_ledger from anon, authenticated;
revoke usage, select on sequence public.point_ledger_id_seq from anon, authenticated;

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
