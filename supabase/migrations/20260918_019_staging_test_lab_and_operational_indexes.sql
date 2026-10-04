-- Nambah 0.5.1 — staging Test Lab + operational indexes.

create table if not exists public.staging_test_lab (
  provider text primary key,
  enabled boolean not null default false,
  scenario text not null default 'success'
    check (scenario in ('success','failed','pending-success','pending-failed')),
  scope text not null default 'next-order'
    check (scope in ('next-order','next-n','until-changed')),
  remaining_uses integer
    check (remaining_uses is null or remaining_uses >= 0),
  updated_at timestamptz not null default now()
);

insert into public.staging_test_lab(provider, enabled, scenario, scope, remaining_uses)
values ('digiflazz', false, 'success', 'next-order', 0)
on conflict (provider) do nothing;

alter table public.staging_test_lab enable row level security;
revoke all on table public.staging_test_lab from public, anon, authenticated;
grant select, insert, update, delete on table public.staging_test_lab to service_role;

alter table public.orders
  add column if not exists environment text
    check (environment is null or environment in ('staging','production')),
  add column if not exists provider_mode text
    check (provider_mode is null or provider_mode in ('disabled','simulate','digiflazz-test','digiflazz-live')),
  add column if not exists test_scenario text
    check (test_scenario is null or test_scenario in ('success','failed','pending-success','pending-failed')),
  add column if not exists test_scenario_source text;

create index if not exists orders_game_id_idx on public.orders(game_id);
create index if not exists orders_payment_method_id_idx on public.orders(payment_method_id);
create index if not exists orders_product_id_idx on public.orders(product_id);
create index if not exists orders_promotion_code_idx on public.orders(promotion_code);
create index if not exists orders_supplier_id_idx on public.orders(supplier_id);
create index if not exists promotion_products_product_id_idx on public.promotion_products(product_id);
create index if not exists supplier_price_snapshots_product_id_idx on public.supplier_price_snapshots(product_id);
create index if not exists supplier_transactions_product_id_idx on public.supplier_transactions(product_id);

create or replace function public.nambah_test_lab_consume(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staging_test_lab%rowtype;
  v_remaining integer;
  v_source text;
begin
  select * into v_row
  from public.staging_test_lab
  where provider = p_provider
  for update;

  if not found or v_row.enabled is not true then
    return jsonb_build_object('enabled', false);
  end if;

  if v_row.scope = 'next-order' then
    v_remaining := 0;
    update public.staging_test_lab
      set enabled = false, remaining_uses = 0, updated_at = now()
      where provider = p_provider;
    v_source := 'admin-next-order';
  elsif v_row.scope = 'next-n' then
    v_remaining := greatest(0, coalesce(v_row.remaining_uses, 1) - 1);
    update public.staging_test_lab
      set enabled = v_remaining > 0, remaining_uses = v_remaining, updated_at = now()
      where provider = p_provider;
    v_source := 'admin-next-n';
  else
    v_remaining := null;
    v_source := 'admin-until-changed';
  end if;

  return jsonb_build_object(
    'enabled', true,
    'scenario', v_row.scenario,
    'scope', v_row.scope,
    'remainingUses', v_remaining,
    'source', v_source
  );
end;
$$;

revoke all on function public.nambah_test_lab_consume(text)
  from public, anon, authenticated;
grant execute on function public.nambah_test_lab_consume(text)
  to service_role;
