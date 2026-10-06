-- Nambah 1.0.11 — promo banner carousel dengan upload gambar admin (Cloudinary).
--
-- Banner kosong -> beranda menampilkan kartu generic (promo aktif / USP),
-- sehingga section tidak pernah rusak.

create table if not exists public.promo_banners (
  id bigint generated always as identity primary key,
  title text not null,
  subtitle text,
  image_url text not null,
  cloudinary_public_id text,
  cta_label text,
  cta_href text,
  promo_code text,
  sort_order integer not null default 100,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists promo_banners_active_sort_idx
  on public.promo_banners(active, sort_order);

alter table public.promo_banners enable row level security;

-- Akses tulis hanya lewat service key (API route). Anon/publik hanya baca
-- banner aktif — dipakai kalau suatu saat ada akses langsung dari client.
drop policy if exists promo_banners_public_read on public.promo_banners;
create policy promo_banners_public_read
  on public.promo_banners
  for select
  using (active = true);
