-- 028: Rating & ulasan produk.
--
-- Rating hanya bisa dibuat oleh pemilik order yang sudah selesai (success).
-- product_id sengaja TIDAK diambil dari request klien: API menyalinnya dari
-- orders.product_id supaya orang tidak bisa menilai produk yang tidak ia beli.
--
-- Satu order = satu ulasan (unique order_id). Ulasan boleh diedit satu kali
-- supaya pelanggan bisa memperbaiki kesalahan ketik tanpa menghitung ulang.

create table if not exists public.product_reviews (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists product_reviews_product_idx
  on public.product_reviews(product_id, created_at desc);

create index if not exists product_reviews_rating_idx
  on public.product_reviews(product_id, rating);

-- Defence in depth: sama seperti tabel lain di schema, RLS aktif dan semua
-- akses lewat service key dari route API (bukan langsung dari browser).
alter table public.product_reviews enable row level security;