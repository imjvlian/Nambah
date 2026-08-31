-- Nambah 0.2.2 — Digiflazz supplier price sync.

create table if not exists public.supplier_price_snapshots (
  id bigint generated always as identity primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  supplier_sku text not null,
  supplier_cost bigint not null check (supplier_cost >= 0),
  buyer_active boolean not null,
  seller_active boolean not null,
  stock bigint,
  unlimited_stock boolean not null default false,
  synced_at timestamptz not null default now()
);

create index if not exists supplier_price_snapshots_lookup_idx
  on public.supplier_price_snapshots(supplier_id, product_id, synced_at desc);

alter table public.supplier_price_snapshots enable row level security;
revoke all on table public.supplier_price_snapshots from anon, authenticated;
revoke usage, select on all sequences in schema public from anon, authenticated;

-- Costs from seed data are placeholders only. A database-backed checkout must not
-- treat them as a live supplier price until a real Digiflazz SKU has been mapped.
update public.supplier_products
set active = false,
    updated_at = now()
where supplier_id = 'digiflazz'
  and supplier_sku is null;
