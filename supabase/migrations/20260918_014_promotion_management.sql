-- Nambah 0.4.18 — promotion management + quota lifecycle.

create table if not exists public.promotion_redemptions (
  id bigint generated always as identity primary key,
  promotion_code text not null references public.promotions(code) on delete cascade,
  order_id text not null unique references public.orders(id) on delete cascade,
  user_id uuid,
  status text not null default 'reserved'
    check (status in ('reserved','redeemed','released')),
  reserved_at timestamptz not null default now(),
  redeemed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists promotion_redemptions_lookup_idx
  on public.promotion_redemptions(promotion_code,status,created_at desc);

create index if not exists promotion_redemptions_user_idx
  on public.promotion_redemptions(promotion_code,user_id,status)
  where user_id is not null;

alter table public.promotion_redemptions enable row level security;
revoke all on table public.promotion_redemptions from anon, authenticated;
revoke usage, select on sequence public.promotion_redemptions_id_seq from anon, authenticated;

create or replace function public.nambah_promotion_reserve(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_user uuid;
  v_quota integer;
  v_quota_per_user integer;
  v_active boolean;
  v_starts timestamptz;
  v_ends timestamptz;
  v_total bigint;
  v_user_total bigint;
begin
  select promotion_code, customer_user_id
    into v_code, v_user
  from public.orders
  where id = p_order_id;

  if v_code is null then
    return jsonb_build_object('reserved', false, 'reason', 'no_promotion');
  end if;

  if exists (
    select 1 from public.promotion_redemptions where order_id = p_order_id
  ) then
    return jsonb_build_object('reserved', true, 'reason', 'existing');
  end if;

  select quota, quota_per_user, active, starts_at, ends_at
    into v_quota, v_quota_per_user, v_active, v_starts, v_ends
  from public.promotions
  where code = v_code
  for update;

  if not found or not v_active then
    raise exception 'Promo tidak aktif.';
  end if;

  if v_starts is not null and v_starts > now() then
    raise exception 'Promo belum dimulai.';
  end if;

  if v_ends is not null and v_ends <= now() then
    raise exception 'Promo sudah berakhir.';
  end if;

  if v_quota is not null then
    select count(*) into v_total
    from public.promotion_redemptions
    where promotion_code = v_code
      and status in ('reserved','redeemed');

    if v_total >= v_quota then
      raise exception 'Kuota promo sudah habis.';
    end if;
  end if;

  if v_quota_per_user is not null and v_user is not null then
    select count(*) into v_user_total
    from public.promotion_redemptions
    where promotion_code = v_code
      and user_id = v_user
      and status in ('reserved','redeemed');

    if v_user_total >= v_quota_per_user then
      raise exception 'Batas penggunaan promo untuk akun ini sudah tercapai.';
    end if;
  end if;

  insert into public.promotion_redemptions(
    promotion_code, order_id, user_id, status
  )
  values(v_code, p_order_id, v_user, 'reserved');

  return jsonb_build_object('reserved', true, 'reason', 'created');
end;
$$;

create or replace function public.nambah_promotion_commit(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.promotion_redemptions
  set status = 'redeemed',
      redeemed_at = coalesce(redeemed_at, now()),
      released_at = null,
      updated_at = now()
  where order_id = p_order_id
    and status = 'reserved';

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.nambah_promotion_release(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.promotion_redemptions
  set status = 'released',
      released_at = coalesce(released_at, now()),
      updated_at = now()
  where order_id = p_order_id
    and status in ('reserved','redeemed');

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.nambah_promotion_reserve(text) from public, anon, authenticated;
revoke all on function public.nambah_promotion_commit(text) from public, anon, authenticated;
revoke all on function public.nambah_promotion_release(text) from public, anon, authenticated;
grant execute on function public.nambah_promotion_reserve(text) to service_role;
grant execute on function public.nambah_promotion_commit(text) to service_role;
grant execute on function public.nambah_promotion_release(text) to service_role;
