-- ============================================================================
-- 045b/046: Brand asli + inquiry form Melostore di cache katalog.
--
-- MASALAH
--
-- Katalog Melostore membawa identitas brand di meta.brands (id -> nama)
-- dan inquiry_form_key per item, tetapi scan kita tidak pernah
-- menyimpannya: kolom `brand` diisi categoryName (sama persis dengan
-- kolom `category`) dan form key dibuang. Akibatnya browser katalog
-- tidak bisa mengelompokkan per brand yang sebenarnya, dan operator
-- tidak tahu input apa yang diminta tiap produk sebelum menambahnya.
--
-- Form definition (fields jsonb) disimpan per (supplier_id, form_key)
-- karena satu form dipakai ratusan SKU - menempelkannya per item
-- menggandakan ukuran cache tanpa informasi baru.
-- ============================================================================

-- 1. Kunci inquiry form per item katalog.
alter table public.supplier_catalog_items
  add column if not exists inquiry_form_key text;

comment on column public.supplier_catalog_items.inquiry_form_key is
  'Kunci form input pelanggan dari katalog supplier (meta.inquiry_forms '
  'Melostore). NULL untuk supplier yang tidak memakai form.';

-- 2. Definisi form: fields jsonb = [{key, name, type}], sesuai bentuk
--    meta.inquiry_forms Melostore. Disimpan utuh supaya scan di masa
--    depan bisa membandingkan apakah definisi berubah.
create table if not exists public.supplier_inquiry_forms (
  supplier_id text not null,
  form_key text not null,
  fields jsonb not null,
  notice text,
  synced_at timestamptz not null default now(),
  primary key (supplier_id, form_key)
);

comment on table public.supplier_inquiry_forms is
  'Definisi form input pelanggan per supplier Melostore H2H. Satu form '
  'dipakai banyak SKU; field pertama -> customer_target, kedua -> '
  'customer_target_zone, sisanya -> additional_data (dengan key field).';
