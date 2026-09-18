-- Nambah 0.6.0 — affiliate ownership + atomic withdrawal workflow.

alter table public.affiliates
  add column if not exists user_id uuid unique references auth.users(id) on delete set null;

create index if not exists affiliates_user_id_idx
  on public.affiliates(user_id)
  where user_id is not null;

alter table public.affiliate_withdrawals
  add column if not exists rejection_reason text,
  add column if not exists external_reference text,
  add column if not exists processed_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists affiliate_withdrawals_processed_by_user_idx
  on public.affiliate_withdrawals(processed_by_user_id)
  where processed_by_user_id is not null;

create index if not exists point_lots_source_order_id_idx
  on public.point_lots(source_order_id)
  where source_order_id is not null;

create table if not exists public.affiliate_withdrawal_allocations (
  id bigint generated always as identity primary key,
  withdrawal_id bigint not null references public.affiliate_withdrawals(id) on delete cascade,
  commission_id bigint not null references public.commissions(id) on delete restrict,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(withdrawal_id, commission_id)
);

create index if not exists affiliate_withdrawal_allocations_commission_idx
  on public.affiliate_withdrawal_allocations(commission_id, withdrawal_id);

alter table public.affiliate_withdrawal_allocations enable row level security;
revoke all on table public.affiliate_withdrawal_allocations from public, anon, authenticated;
grant select, insert, update, delete on table public.affiliate_withdrawal_allocations to service_role;
revoke usage, select on sequence public.affiliate_withdrawal_allocations_id_seq from public, anon, authenticated;
grant usage, select on sequence public.affiliate_withdrawal_allocations_id_seq to service_role;

create or replace function public.nambah_affiliate_request_withdrawal(
  p_user_id uuid,
  p_amount bigint,
  p_method text,
  p_account_name text,
  p_account_number text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_affiliate_code text;
  v_withdrawal_id bigint;
  v_needed bigint;
  v_available bigint := 0;
  v_commission record;
  v_reserved bigint;
  v_take bigint;
begin
  if p_amount <= 0 then
    raise exception 'Nominal withdrawal harus lebih dari 0.';
  end if;

  if length(trim(coalesce(p_method,''))) < 2
     or length(trim(coalesce(p_account_name,''))) < 2
     or length(trim(coalesce(p_account_number,''))) < 4 then
    raise exception 'Data rekening withdrawal belum lengkap.';
  end if;

  select code into v_affiliate_code
  from public.affiliates
  where user_id = p_user_id and status = 'active'
  for update;

  if v_affiliate_code is null then
    raise exception 'Akun ini belum terhubung ke affiliate aktif.';
  end if;

  if exists (
    select 1 from public.affiliate_withdrawals
    where affiliate_code = v_affiliate_code
      and status in ('pending','approved')
  ) then
    raise exception 'Masih ada withdrawal yang sedang diproses.';
  end if;

  select coalesce(sum(
    greatest(0, c.amount - coalesce((
      select sum(a.amount)
      from public.affiliate_withdrawal_allocations a
      join public.affiliate_withdrawals w on w.id = a.withdrawal_id
      where a.commission_id = c.id
        and w.status in ('pending','approved','paid')
    ),0))
  ),0)
  into v_available
  from public.commissions c
  where c.affiliate_code = v_affiliate_code
    and c.status = 'available';

  if p_amount > v_available then
    raise exception 'Saldo affiliate tersedia tidak mencukupi.';
  end if;

  insert into public.affiliate_withdrawals(
    affiliate_code, amount, method, account_name, account_number,
    status, requested_at, created_at, updated_at
  )
  values(
    v_affiliate_code,
    p_amount,
    left(trim(p_method),80),
    left(trim(p_account_name),120),
    left(trim(p_account_number),120),
    'pending',
    now(),
    now(),
    now()
  )
  returning id into v_withdrawal_id;

  v_needed := p_amount;

  for v_commission in
    select id, amount
    from public.commissions
    where affiliate_code = v_affiliate_code
      and status = 'available'
    order by available_at asc nulls last, id asc
    for update
  loop
    select coalesce(sum(a.amount),0)
    into v_reserved
    from public.affiliate_withdrawal_allocations a
    join public.affiliate_withdrawals w on w.id = a.withdrawal_id
    where a.commission_id = v_commission.id
      and w.status in ('pending','approved','paid');

    v_take := least(v_needed, greatest(0, v_commission.amount - v_reserved));

    if v_take > 0 then
      insert into public.affiliate_withdrawal_allocations(
        withdrawal_id, commission_id, amount
      )
      values(v_withdrawal_id, v_commission.id, v_take);
      v_needed := v_needed - v_take;
    end if;

    exit when v_needed = 0;
  end loop;

  if v_needed > 0 then
    raise exception 'Allocation commission tidak konsisten.';
  end if;

  return jsonb_build_object(
    'withdrawalId', v_withdrawal_id,
    'affiliateCode', v_affiliate_code,
    'amount', p_amount,
    'status', 'pending'
  );
end;
$$;

create or replace function public.nambah_affiliate_cancel_withdrawal(
  p_user_id uuid,
  p_withdrawal_id bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_affiliate_code text;
  v_status text;
begin
  select code into v_affiliate_code
  from public.affiliates
  where user_id = p_user_id
  limit 1;

  if v_affiliate_code is null then
    raise exception 'Affiliate tidak ditemukan.';
  end if;

  select status into v_status
  from public.affiliate_withdrawals
  where id = p_withdrawal_id
    and affiliate_code = v_affiliate_code
  for update;

  if v_status is null then
    raise exception 'Withdrawal tidak ditemukan.';
  end if;

  if v_status <> 'pending' then
    raise exception 'Hanya withdrawal pending yang dapat dibatalkan.';
  end if;

  update public.affiliate_withdrawals
  set status = 'cancelled',
      processed_at = now(),
      updated_at = now()
  where id = p_withdrawal_id;

  return jsonb_build_object(
    'withdrawalId', p_withdrawal_id,
    'status', 'cancelled'
  );
end;
$$;

create or replace function public.nambah_affiliate_transition_withdrawal(
  p_withdrawal_id bigint,
  p_action text,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_external_reference text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.affiliate_withdrawals%rowtype;
begin
  select * into v_row
  from public.affiliate_withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'Withdrawal tidak ditemukan.';
  end if;

  if p_action = 'approve' then
    if v_row.status <> 'pending' then
      raise exception 'Withdrawal hanya dapat di-approve dari status pending.';
    end if;

    update public.affiliate_withdrawals
    set status = 'approved',
        processed_at = now(),
        processed_by_user_id = p_actor_user_id,
        rejection_reason = null,
        updated_at = now()
    where id = p_withdrawal_id;

  elsif p_action = 'reject' then
    if v_row.status not in ('pending','approved') then
      raise exception 'Withdrawal tidak dapat ditolak dari status saat ini.';
    end if;

    update public.affiliate_withdrawals
    set status = 'rejected',
        processed_at = now(),
        processed_by_user_id = p_actor_user_id,
        rejection_reason = nullif(left(trim(coalesce(p_reason,'')),500),''),
        updated_at = now()
    where id = p_withdrawal_id;

  elsif p_action = 'paid' then
    if v_row.status <> 'approved' then
      raise exception 'Withdrawal harus approved sebelum ditandai paid.';
    end if;

    update public.affiliate_withdrawals
    set status = 'paid',
        processed_at = coalesce(processed_at, now()),
        paid_at = now(),
        processed_by_user_id = p_actor_user_id,
        external_reference = nullif(left(trim(coalesce(p_external_reference,'')),200),''),
        updated_at = now()
    where id = p_withdrawal_id;

    update public.commissions c
    set status = 'withdrawn',
        updated_at = now()
    where c.status = 'available'
      and c.id in (
        select commission_id
        from public.affiliate_withdrawal_allocations
        where withdrawal_id = p_withdrawal_id
      )
      and coalesce((
        select sum(a.amount)
        from public.affiliate_withdrawal_allocations a
        join public.affiliate_withdrawals w on w.id = a.withdrawal_id
        where a.commission_id = c.id
          and w.status = 'paid'
      ),0) >= c.amount;

  else
    raise exception 'Action withdrawal tidak valid.';
  end if;

  return (
    select jsonb_build_object(
      'withdrawalId', id,
      'affiliateCode', affiliate_code,
      'amount', amount,
      'status', status,
      'processedAt', processed_at,
      'paidAt', paid_at
    )
    from public.affiliate_withdrawals
    where id = p_withdrawal_id
  );
end;
$$;

create or replace function public.nambah_affiliate_summary(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_pending bigint := 0;
  v_available bigint := 0;
  v_reserved bigint := 0;
  v_withdrawn bigint := 0;
begin
  select * into v_affiliate
  from public.affiliates
  where user_id = p_user_id
  limit 1;

  if not found then
    return jsonb_build_object('affiliate', null);
  end if;

  select coalesce(sum(amount),0)
  into v_pending
  from public.commissions
  where affiliate_code = v_affiliate.code
    and status = 'pending';

  select coalesce(sum(
    greatest(0, c.amount - coalesce((
      select sum(a.amount)
      from public.affiliate_withdrawal_allocations a
      join public.affiliate_withdrawals w on w.id = a.withdrawal_id
      where a.commission_id = c.id
        and w.status in ('pending','approved','paid')
    ),0))
  ),0)
  into v_available
  from public.commissions c
  where c.affiliate_code = v_affiliate.code
    and c.status = 'available';

  select coalesce(sum(a.amount),0)
  into v_reserved
  from public.affiliate_withdrawal_allocations a
  join public.affiliate_withdrawals w on w.id = a.withdrawal_id
  where w.affiliate_code = v_affiliate.code
    and w.status in ('pending','approved');

  select coalesce(sum(amount),0)
  into v_withdrawn
  from public.affiliate_withdrawals
  where affiliate_code = v_affiliate.code
    and status = 'paid';

  return jsonb_build_object(
    'affiliate', jsonb_build_object(
      'code', v_affiliate.code,
      'displayName', v_affiliate.display_name,
      'commissionRate', v_affiliate.commission_rate,
      'status', v_affiliate.status,
      'pending', v_pending,
      'available', v_available,
      'reserved', v_reserved,
      'withdrawn', v_withdrawn
    )
  );
end;
$$;

revoke all on function public.nambah_affiliate_request_withdrawal(uuid,bigint,text,text,text)
  from public, anon, authenticated;
revoke all on function public.nambah_affiliate_cancel_withdrawal(uuid,bigint)
  from public, anon, authenticated;
revoke all on function public.nambah_affiliate_transition_withdrawal(bigint,text,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.nambah_affiliate_summary(uuid)
  from public, anon, authenticated;

grant execute on function public.nambah_affiliate_request_withdrawal(uuid,bigint,text,text,text)
  to service_role;
grant execute on function public.nambah_affiliate_cancel_withdrawal(uuid,bigint)
  to service_role;
grant execute on function public.nambah_affiliate_transition_withdrawal(bigint,text,uuid,text,text)
  to service_role;
grant execute on function public.nambah_affiliate_summary(uuid)
  to service_role;
