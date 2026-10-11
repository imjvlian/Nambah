-- ============================================================================
-- 043 - SKU internal produk
-- ============================================================================
--
-- Semua produk Nambah lahir dari sinkronisasi Digiflazz: id-nya
-- `df-<sku digiflazz>-<hash>`. Artinya identitas produk MEMBAWA kode
-- Digiflazz di dalamnya, dan menambah supplier kedua dengan kondisi itu
-- berarti identitas produk bergantung pada salah satu suppliernya.
--
-- Kolom ini menyimpan SKU milik Lacte Game Store sendiri - format
-- `<BRAND>-<NAMA PRODUK>` (mis. MLBB-50-DIAMOND), digenerate dari alias
-- brand dan label produk. Generatornya ada di src/lib/internal-sku.ts;
-- SQL di sini hanya menyediakan tempatnya dan jaminan keunikannya.
--
-- KENAPA TIDAK MENGGANTI products.id
--
-- Seluruh foreign key order menunjuk products.id, dan checkout memakai
-- id itu. Mengganti id berarti memindahkan identitas di bawah transaksi
-- yang sudah berjalan. SKU internal adalah PENANDA yang dibaca manusia;
-- ia tidak menggantikan id, dan checkout tidak berubah.
--
-- KENAPA NULLABLE
--
-- Backfill dijalankan lewat endpoint admin (bukan lewat SQL), karena
-- normalisasi label dan alias brand punya aturan yang lebih mudah
-- diuji di TypeScript - dan aturan yang salah di sini menjadi SKU yang
-- salah selamanya. Sebelum backfill dijalankan, kolomnya memang kosong.
--
-- KENAPA UNIQUE
--
-- Dua produk dengan SKU sama berarti satu dari keduanya tidak bisa
-- dibedakan di laporan dan nota. Constraint menegakkan itu di database,
-- bukan hanya di UI; generator yang menghadapi duplikat WAJIB menambah
-- akhiran (internalSkuWithSuffix), bukan menimpa produk yang sudah ada.

alter table public.products
  add column if not exists internal_sku text;

comment on column public.products.internal_sku is
  'SKU milik Lacte Game Store, format <BRAND>-<NAMA PRODUK>. Dibangkitkan '
  'dari alias brand dan label produk; tidak berubah saat harga, gambar, '
  'status, atau mapping supplier diubah. Tidak dipakai sebagai kode '
  'supplier - kode Digiflazz dan Melostore ada di supplier_products.';

-- unique menolak duplikat, dan index membuat pencarian by-SKU cepat.
-- Partial (where internal_sku is not null) supaya produk yang belum
-- di-backfill tidak saling bertabrakan di index yang sama.
create unique index if not exists products_internal_sku_idx
  on public.products (internal_sku)
  where internal_sku is not null;

create index if not exists products_internal_sku_lookup_idx
  on public.products (internal_sku)
  where internal_sku is not null;