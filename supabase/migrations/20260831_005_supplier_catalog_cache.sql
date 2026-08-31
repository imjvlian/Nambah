-- Nambah 0.3.1 — cached supplier catalog for Digiflazz bootstrap.

create table if not exists public.supplier_catalog_items (
  supplier_id text not null references public.suppliers(id) on delete cascade,
  supplier_sku text not null,
  product_name text not null,
  category text not null,
  brand text not null,
  type text not null,
  seller_name text not null,
  supplier_cost bigint not null check (supplier_cost >= 0),
  buyer_active boolean not null,
  seller_active boolean not null,
  unlimited_stock boolean not null default false,
  stock bigint,
  multi boolean not null default false,
  start_cut_off text,
  end_cut_off text,
  description text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, supplier_sku)
);

create index if not exists supplier_catalog_items_brand_idx
  on public.supplier_catalog_items(supplier_id, brand, buyer_active, seller_active);

create index if not exists supplier_catalog_items_seen_idx
  on public.supplier_catalog_items(supplier_id, last_seen_at desc);

alter table public.supplier_catalog_items enable row level security;
revoke all on table public.supplier_catalog_items from anon, authenticated;
