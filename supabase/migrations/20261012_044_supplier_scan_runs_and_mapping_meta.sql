-- ============================================================================
-- 044 - catatan scan supplier + metadata pemetaan
-- ============================================================================
--
-- DUA KEKURANGAN YANG MENJADI ALASAN MIGRASI INI
--
-- 1. Tidak ada catatan scan. Tombol scan menjalankan upsert lalu selesai -
--    tidak ada jejak kapan terakhir berhasil, berapa yang ditemukan/baru/
--    diperbarui, atau apakah scan selesai sebagian. Operator hanya melihat
--    notifikasi sekali pakai yang hilang setelah refresh.
--
-- 2. Tidak ada metadata pemetaan. Mapping yang dibuat otomatis dan manual
--    tidak bisa dibedakan - dan saat mapping terindikasi salah, tidak ada
--    cara mengetahui siapa yang memasangnya dan kapan.
--
-- KEDUA tabel/kolom ini tambahan murni: tidak ada kolom lama yang diubah,
-- tidak ada data yang digeser.

-- ----------------------------------------------------------------------------
-- 1. supplier_scan_runs
-- ----------------------------------------------------------------------------
-- Satu baris per percobaan scan, TERMASUK yang gagal dan yang masih
-- berjalan. Baris `running` juga berfungsi sebagai kunci anti-scan-
-- bersamaan: route menolak memulai kalau masih ada baris running yang
-- segar, karena dua scan yang menulis ke tabel yang sama akan membuat
-- jumlah "baru"/"diperbarui" tidak bisa dipercaya.

create table if not exists public.supplier_scan_runs (
  id bigint generated always as identity primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  -- running  : scan masih berjalan (juga dipakai sebagai kunci bersama)
  -- success  : semua halaman berhasil, deaktivasi boleh
  -- partial  : beberapa halaman gagal; data yang terkumpul sah, tapi
  --            SKU TIDAK BOLEH ditandai tidak tersedia karena hasilnya
  --            tidak lengkap
  -- failed   : tidak ada data yang bisa dipakai
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_total integer not null default 0,
  pages_failed integer not null default 0,
  found_count integer not null default 0,
  new_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  deactivated_count integer not null default 0,
  error text,
  triggered_by text
);

create index if not exists supplier_scan_runs_supplier_idx
  on public.supplier_scan_runs (supplier_id, started_at desc);

alter table public.supplier_scan_runs enable row level security;
revoke all on table public.supplier_scan_runs from anon, authenticated;

comment on table public.supplier_scan_runs is
  'Jejak setiap scan katalog supplier. Status partial berarti sebagian '
  'halaman gagal: data yang terkumpul sah disimpan, tapi SKU TIDAK BOLEH '
  'ditandai tidak tersedia karena hasil scan tidak lengkap.';

-- ----------------------------------------------------------------------------
-- 2. Metadata pemetaan di supplier_products
-- ----------------------------------------------------------------------------

alter table public.supplier_products
  add column if not exists mapped_via text;

alter table public.supplier_products
  add column if not exists mapped_by text;

alter table public.supplier_products
  add column if not exists mapped_at timestamptz;

alter table public.supplier_products
  add column if not exists mapped_note text;

-- Constraint dibuat lewat DO block supaya aman dijalankan ulang.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_products_mapped_via_check'
      and conrelid = 'public.supplier_products'::regclass
  ) then
    alter table public.supplier_products
      add constraint supplier_products_mapped_via_check
      check (mapped_via is null or mapped_via in ('auto', 'manual'));
  end if;
end $$;

comment on column public.supplier_products.mapped_via is
  'auto: dipasang pencocokan otomatis (hanya saat kandidat pasti tunggal). '
  'manual: dipilih operator. NULL: mapping lama sebelum kolom ini ada - '
  'biarkan NULL, jangan menebak.';
comment on column public.supplier_products.mapped_by is
  'Id admin yang mengonfirmasi mapping manual. NULL untuk mapping otomatis.';
comment on column public.supplier_products.mapped_note is
  'Alasan mapping manual, diisi operator saat memetakan produk dengan nama '
  'berbeda.';