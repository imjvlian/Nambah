-- 0.2.3 — Digiflazz supplier balance monitoring.
-- Safe to run once after the 0.2.0 bootstrap + previous migrations.

alter table public.supplier_balance_snapshots
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_balance_snapshots_source_check'
      and conrelid = 'public.supplier_balance_snapshots'::regclass
  ) then
    alter table public.supplier_balance_snapshots
      add constraint supplier_balance_snapshots_source_check
      check (source in ('manual', 'periodic', 'transaction'));
  end if;
end $$;

create index if not exists supplier_balance_snapshots_status_idx
  on public.supplier_balance_snapshots(supplier_id, status, checked_at desc);
