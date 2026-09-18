-- Nambah 0.5.4 live hotfix record.
-- Migration 020 in the repository already contains the corrected function for
-- fresh installs. This migration is intentionally idempotent and records the
-- live-database correction that preserved reserved allocations during reversal.

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

revoke all on function public.nambah_points_reverse_earn(text) from public,anon,authenticated;
grant execute on function public.nambah_points_reverse_earn(text) to service_role;
