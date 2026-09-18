-- Nambah 0.5.4 — FIFO Points lots and safe expiry.
-- Existing pre-lot balances are converted lazily to a non-expiring legacy lot
-- on the first reservation so upgrades do not incorrectly expire old balances.

create table if not exists public.point_lots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null unique,
  source_order_id text references public.orders(id) on delete set null,
  kind text not null default 'earn'
    check (kind in ('earn','refund','legacy','admin')),
  original_points bigint not null check (original_points > 0),
  remaining_points bigint not null check (
    remaining_points >= 0 and remaining_points <= original_points
  ),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists point_lots_user_expiry_idx
  on public.point_lots(user_id,expires_at,id)
  where remaining_points > 0;

create table if not exists public.point_redemption_allocations (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  lot_id bigint not null references public.point_lots(id) on delete cascade,
  points bigint not null check (points > 0),
  status text not null default 'reserved'
    check (status in ('reserved','committed','restored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,lot_id)
);

create index if not exists point_redemption_allocations_lot_status_idx
  on public.point_redemption_allocations(lot_id,status);

alter table public.point_lots enable row level security;
alter table public.point_redemption_allocations enable row level security;
revoke all on table public.point_lots from public, anon, authenticated;
revoke all on table public.point_redemption_allocations from public, anon, authenticated;
grant select, insert, update, delete on table public.point_lots to service_role;
grant select, insert, update, delete on table public.point_redemption_allocations to service_role;
revoke usage, select on sequence public.point_lots_id_seq from public, anon, authenticated;
revoke usage, select on sequence public.point_redemption_allocations_id_seq from public, anon, authenticated;
grant usage, select on sequence public.point_lots_id_seq to service_role;
grant usage, select on sequence public.point_redemption_allocations_id_seq to service_role;

create or replace function public.nambah_points_reserve(p_user_id uuid,p_order_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_order_user uuid; v_points bigint; v_needed bigint; v_available bigint;
  v_account public.loyalty_accounts%rowtype; v_lot public.point_lots%rowtype;
  v_lot_reserved bigint; v_take bigint; v_tracked_available bigint; v_legacy_points bigint;
begin
  select customer_user_id,points_redeemed into v_order_user,v_points
  from public.orders where id=p_order_id;
  if v_order_user is null or v_order_user<>p_user_id then raise exception 'Order tidak dimiliki user Nambah yang valid.'; end if;
  if coalesce(v_points,0)<=0 then return jsonb_build_object('pointsBalance',0,'reservedPoints',0,'availablePoints',0); end if;
  insert into public.loyalty_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into v_account from public.loyalty_accounts where user_id=p_user_id for update;
  if exists(select 1 from public.point_ledger where idempotency_key='reserve:'||p_order_id) then
    return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
  end if;
  v_available:=v_account.points_balance-v_account.reserved_points;
  if v_available<v_points then raise exception 'Saldo Nambah Points tidak mencukupi.'; end if;
  select coalesce(sum(greatest(0,l.remaining_points-coalesce((
    select sum(a.points) from public.point_redemption_allocations a where a.lot_id=l.id and a.status='reserved'
  ),0))),0) into v_tracked_available from public.point_lots l where l.user_id=p_user_id;
  v_legacy_points:=greatest(0,v_available-v_tracked_available);
  if v_legacy_points>0 then
    insert into public.point_lots(user_id,source_key,kind,original_points,remaining_points,expires_at)
    values(p_user_id,'legacy:'||p_user_id::text,'legacy',v_legacy_points,v_legacy_points,null)
    on conflict(source_key) do update set
      original_points=public.point_lots.original_points+excluded.original_points,
      remaining_points=public.point_lots.remaining_points+excluded.remaining_points,
      updated_at=now();
  end if;
  v_needed:=v_points;
  for v_lot in select * from public.point_lots
    where user_id=p_user_id and remaining_points>0 and (expires_at is null or expires_at>now())
    order by expires_at asc nulls last,id asc for update
  loop
    select coalesce(sum(points),0) into v_lot_reserved from public.point_redemption_allocations
      where lot_id=v_lot.id and status='reserved';
    v_take:=least(v_needed,greatest(0,v_lot.remaining_points-v_lot_reserved));
    if v_take>0 then
      insert into public.point_redemption_allocations(order_id,lot_id,points,status)
      values(p_order_id,v_lot.id,v_take,'reserved');
      v_needed:=v_needed-v_take;
    end if;
    exit when v_needed=0;
  end loop;
  if v_needed>0 then raise exception 'Lot Nambah Points yang tersedia tidak mencukupi.'; end if;
  update public.loyalty_accounts set reserved_points=reserved_points+v_points,updated_at=now()
    where user_id=p_user_id returning * into v_account;
  insert into public.point_ledger(user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,idempotency_key,note)
  values(p_user_id,p_order_id,'reserve',0,v_points,v_account.points_balance,v_account.reserved_points,'reserve:'||p_order_id,'Nambah Points reserved for checkout using FIFO lots');
  return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
end $$;

create or replace function public.nambah_points_commit_redemption(p_order_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid; v_points bigint; v_allocated bigint; v_account public.loyalty_accounts%rowtype; v_allocation record;
begin
  select customer_user_id,points_redeemed into v_user,v_points from public.orders where id=p_order_id;
  if v_user is null or coalesce(v_points,0)<=0 then return '{}'::jsonb; end if;
  select * into v_account from public.loyalty_accounts where user_id=v_user for update;
  if not found then raise exception 'Loyalty account tidak ditemukan.'; end if;
  if exists(select 1 from public.point_ledger where idempotency_key='redeem:'||p_order_id) then
    return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
  end if;
  if exists(select 1 from public.point_ledger where idempotency_key='restore:'||p_order_id) then raise exception 'Reservation points order sudah dipulihkan.'; end if;
  select coalesce(sum(points),0) into v_allocated from public.point_redemption_allocations where order_id=p_order_id and status='reserved';
  if v_allocated<>v_points or v_account.reserved_points<v_points then raise exception 'Allocation Nambah Points tidak konsisten.'; end if;
  for v_allocation in select id,lot_id,points from public.point_redemption_allocations
    where order_id=p_order_id and status='reserved' order by id for update
  loop
    update public.point_lots set remaining_points=remaining_points-v_allocation.points,updated_at=now()
      where id=v_allocation.lot_id and remaining_points>=v_allocation.points;
    if not found then raise exception 'Point lot tidak mencukupi saat commit.'; end if;
    update public.point_redemption_allocations set status='committed',updated_at=now() where id=v_allocation.id;
  end loop;
  update public.loyalty_accounts set points_balance=points_balance-v_points,reserved_points=reserved_points-v_points,
    lifetime_redeemed=lifetime_redeemed+v_points,updated_at=now() where user_id=v_user returning * into v_account;
  insert into public.point_ledger(user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,idempotency_key,note)
  values(v_user,p_order_id,'redeem',-v_points,-v_points,v_account.points_balance,v_account.reserved_points,'redeem:'||p_order_id,'Nambah Points committed from FIFO lots after payment verification');
  return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
end $$;

create or replace function public.nambah_points_restore_redemption(p_order_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid; v_points bigint; v_account public.loyalty_accounts%rowtype; v_committed boolean; v_allocation record;
begin
  select customer_user_id,points_redeemed into v_user,v_points from public.orders where id=p_order_id;
  if v_user is null or coalesce(v_points,0)<=0 then return '{}'::jsonb; end if;
  select * into v_account from public.loyalty_accounts where user_id=v_user for update;
  if not found then return '{}'::jsonb; end if;
  if exists(select 1 from public.point_ledger where idempotency_key='restore:'||p_order_id) then
    return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
  end if;
  select exists(select 1 from public.point_ledger where idempotency_key='redeem:'||p_order_id) into v_committed;
  if v_committed then
    for v_allocation in select id,lot_id,points from public.point_redemption_allocations
      where order_id=p_order_id and status='committed' order by id for update
    loop
      update public.point_lots set remaining_points=least(original_points,remaining_points+v_allocation.points),updated_at=now()
        where id=v_allocation.lot_id;
      update public.point_redemption_allocations set status='restored',updated_at=now() where id=v_allocation.id;
    end loop;
    update public.loyalty_accounts set points_balance=points_balance+v_points,updated_at=now()
      where user_id=v_user returning * into v_account;
    insert into public.point_ledger(user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,idempotency_key,note)
    values(v_user,p_order_id,'refund',v_points,0,v_account.points_balance,v_account.reserved_points,'restore:'||p_order_id,'Redeemed Nambah Points returned to original lots after terminal failure/refund');
  elsif exists(select 1 from public.point_ledger where idempotency_key='reserve:'||p_order_id) then
    update public.point_redemption_allocations set status='restored',updated_at=now()
      where order_id=p_order_id and status='reserved';
    update public.loyalty_accounts set reserved_points=greatest(0,reserved_points-v_points),updated_at=now()
      where user_id=v_user returning * into v_account;
    insert into public.point_ledger(user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,idempotency_key,note)
    values(v_user,p_order_id,'release',0,-v_points,v_account.points_balance,v_account.reserved_points,'restore:'||p_order_id,'Nambah Points reservation released');
  else
    return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
  end if;
  return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
end $$;

create or replace function public.nambah_points_earn(p_order_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid; v_points bigint; v_status text; v_account public.loyalty_accounts%rowtype;
  v_expires_at timestamptz:=now()+interval '12 months';
begin
  select customer_user_id,points_earned,status into v_user,v_points,v_status from public.orders where id=p_order_id;
  if v_user is null or coalesce(v_points,0)<=0 then return '{}'::jsonb; end if;
  if v_status<>'success' then raise exception 'Points hanya dapat diberikan untuk order success.'; end if;
  insert into public.loyalty_accounts(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_account from public.loyalty_accounts where user_id=v_user for update;
  if exists(select 1 from public.point_ledger where idempotency_key='earn:'||p_order_id) then
    return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
  end if;
  update public.loyalty_accounts set points_balance=points_balance+v_points,lifetime_earned=lifetime_earned+v_points,updated_at=now()
    where user_id=v_user returning * into v_account;
  insert into public.point_lots(user_id,source_key,source_order_id,kind,original_points,remaining_points,expires_at)
    values(v_user,'earn:'||p_order_id,p_order_id,'earn',v_points,v_points,v_expires_at) on conflict(source_key) do nothing;
  insert into public.point_ledger(user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,idempotency_key,note,expires_at)
    values(v_user,p_order_id,'earn',v_points,0,v_account.points_balance,v_account.reserved_points,'earn:'||p_order_id,'Nambah Points earned from successful transaction',v_expires_at);
  return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
end $$;

create or replace function public.nambah_points_reverse_earn(p_order_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid; v_points bigint; v_account public.loyalty_accounts%rowtype; v_reserved bigint; v_lot_id bigint;
begin
  select customer_user_id,points_earned into v_user,v_points from public.orders where id=p_order_id;
  if v_user is null or coalesce(v_points,0)<=0 then return '{}'::jsonb; end if;
  select * into v_account from public.loyalty_accounts where user_id=v_user for update;
  if not found then return '{}'::jsonb; end if;
  if not exists(select 1 from public.point_ledger where idempotency_key='earn:'||p_order_id)
     or exists(select 1 from public.point_ledger where idempotency_key='reverse-earn:'||p_order_id) then
    return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
  end if;
  select id into v_lot_id from public.point_lots where source_key='earn:'||p_order_id for update;
  if v_lot_id is not null then
    select coalesce(sum(points),0) into v_reserved from public.point_redemption_allocations where lot_id=v_lot_id and status='reserved';
    update public.point_lots set remaining_points=least(remaining_points,v_reserved),updated_at=now() where id=v_lot_id;
  end if;
  update public.loyalty_accounts set points_balance=points_balance-v_points,updated_at=now()
    where user_id=v_user returning * into v_account;
  insert into public.point_ledger(user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,idempotency_key,note)
    values(v_user,p_order_id,'reversal',-v_points,0,v_account.points_balance,v_account.reserved_points,'reverse-earn:'||p_order_id,'Earned Nambah Points reversed after refund/failure');
  return jsonb_build_object('pointsBalance',v_account.points_balance,'reservedPoints',v_account.reserved_points,'availablePoints',v_account.points_balance-v_account.reserved_points);
end $$;

create or replace function public.nambah_points_expire(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lot public.point_lots%rowtype; v_account public.loyalty_accounts%rowtype;
  v_reserved bigint; v_expirable bigint; v_new_remaining bigint; v_expired_points bigint:=0; v_lots integer:=0;
begin
  if p_limit<1 or p_limit>1000 then raise exception 'Expiry batch limit tidak valid.'; end if;
  for v_lot in select * from public.point_lots
    where expires_at is not null and expires_at<=now() and remaining_points>0
    order by expires_at asc,id asc limit p_limit for update skip locked
  loop
    select * into v_account from public.loyalty_accounts where user_id=v_lot.user_id for update;
    if not found then continue; end if;
    select coalesce(sum(points),0) into v_reserved from public.point_redemption_allocations where lot_id=v_lot.id and status='reserved';
    v_expirable:=greatest(0,v_lot.remaining_points-v_reserved);
    if v_expirable<=0 then continue; end if;
    v_new_remaining:=v_lot.remaining_points-v_expirable;
    update public.point_lots set remaining_points=v_new_remaining,updated_at=now() where id=v_lot.id;
    update public.loyalty_accounts set points_balance=points_balance-v_expirable,updated_at=now()
      where user_id=v_lot.user_id returning * into v_account;
    insert into public.point_ledger(user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,idempotency_key,note)
      values(v_lot.user_id,v_lot.source_order_id,'expire',-v_expirable,0,v_account.points_balance,v_account.reserved_points,
      'expire:'||v_lot.id::text||':'||v_new_remaining::text,'Nambah Points expired from lot '||v_lot.id::text)
      on conflict(idempotency_key) do nothing;
    v_expired_points:=v_expired_points+v_expirable; v_lots:=v_lots+1;
  end loop;
  return jsonb_build_object('lotsProcessed',v_lots,'pointsExpired',v_expired_points);
end $$;

revoke all on function public.nambah_points_reserve(uuid,text) from public,anon,authenticated;
revoke all on function public.nambah_points_commit_redemption(text) from public,anon,authenticated;
revoke all on function public.nambah_points_restore_redemption(text) from public,anon,authenticated;
revoke all on function public.nambah_points_earn(text) from public,anon,authenticated;
revoke all on function public.nambah_points_reverse_earn(text) from public,anon,authenticated;
revoke all on function public.nambah_points_expire(integer) from public,anon,authenticated;
grant execute on function public.nambah_points_reserve(uuid,text) to service_role;
grant execute on function public.nambah_points_commit_redemption(text) to service_role;
grant execute on function public.nambah_points_restore_redemption(text) to service_role;
grant execute on function public.nambah_points_earn(text) to service_role;
grant execute on function public.nambah_points_reverse_earn(text) to service_role;
grant execute on function public.nambah_points_expire(integer) to service_role;
