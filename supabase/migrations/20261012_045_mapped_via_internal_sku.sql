-- ============================================================================
-- 045: Izinkan 'internal-sku' pada supplier_products.mapped_via
--
-- Merge via jalur SKU internal (aksi merge-internal-sku) memasang pasangan
-- Melostore-ke-produk berdasarkan identitas GAME-JENIS-NOMINAL[-REGION],
-- bukan tebakan label. Metadata ini penting dibedakan dari 'auto'
-- (pencocokan label) karena:
--   1. Operator perlu tahu pasangan mana yang aman diulang setelah daftar
--      prefiks game berubah - pasangan 'auto' harus ditinjau ulang,
--      pasangan 'internal-sku' tidak.
--   2. Audit: dua jalur yang berbeda keputusannya tidak boleh terlihat
--      sama di riwayat.
--
-- Constraint lama hanya mengizinkan ('auto', 'manual') - nilai baru
-- ditolak 23514 sehingga merge menemukan pasangan yang benar tetapi
-- gagal menyimpan (terbukti di uji nyata: mlid296d-s1 -> MLBB-DM-296
-- ditolak padahal produknya ada).
--
-- Aman dijalankan ulang: constraint di-drop lalu dibuat ulang dengan
-- daftar nilai yang lengkap.
-- ============================================================================

alter table public.supplier_products
  drop constraint if exists supplier_products_mapped_via_check;

alter table public.supplier_products
  add constraint supplier_products_mapped_via_check
  check (mapped_via is null or mapped_via in ('auto', 'manual', 'internal-sku'));

comment on column public.supplier_products.mapped_via is
  'auto: dipasang pencocokan label otomatis (hanya saat kandidat pasti tunggal). '
  'manual: dipilih operator. internal-sku: dipasang merge berbasis SKU internal '
  '(identitas GAME-JENIS-NOMINAL[-REGION] cocok persis). '
  'NULL: mapping lama sebelum kolom ini ada - biarkan NULL, jangan menebak.';
