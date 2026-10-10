-- ============================================================================
-- 040 — biaya layanan FLAT (rupiah), self-registration, dashboard toko
-- ============================================================================
--
-- 1. Biaya layanan: persen -> nominal rupiah
-- 2. `status` merchant gaining `pending` untuk pendaftaran mandiri
--
-- MIGRASI SUSULAN. `merchants` sudah dibuat di 036 dan SUDAH DIJALANKAN, jadi
-- perubahan skema harus lewat file baru, bukan menyunting 036.
--
-- MENGAPA PERSEN DIGANTI FLAT
--
-- Persen memaksa pembeli melakukan aritmetika: "3% dari 20.000 = 600".
-- Flat tidak. Untuk nominal top up yang bervariasi, biaya persen membuat
-- tagihan di konter berbeda tiap produk, dan kasir harus menghitung di
-- depan customer. Flat juga butuh satu angka di layar admin, bukan satu
-- angka plus interpretasi.
--
-- Flat TIDAK bisa dikonversi dari persen yang sudah ada. Nilai persen
-- bergantung pada harga produk, dan harga itu tidak ada di baris
-- `merchants`. Tidak ada merchant aktif saat migrasi ini ditulis, jadi
-- tidak ada data yang hilang - tapi backend tetap menolak convert diam-diam
-- dan amazed karena nilainya tidak bisa diketahui.

alter table public.merchants
  add column if not exists service_fee_flat_idr bigint;

update public.merchants
  set service_fee_flat_idr = 0
  where service_fee_flat_idr is null;

alter table public.merchants
  alter column service_fee_flat_idr set default 0,
  alter column service_fee_flat_idr set not null;

-- Check >= 0 tanpa batas atas: biaya layanan tidak boleh negatif. Tidak ada
-- maximum karena ini keputusan bisnis per merchant, bukan parameter sistem.
alter table public.merchants
  drop constraint if exists merchants_service_fee_flat_idr_check;

alter table public.merchants
  add constraint merchants_service_fee_flat_idr_check
  check (service_fee_flat_idr >= 0);

alter table public.merchants
  drop column if exists service_fee_percent;

-- Snapshot di order mengikuti perubahan yang sama: yang disimpan adalah
-- NOMINAL yang dilihat user, bukan persentasenya.
alter table public.orders
  add column if not exists service_fee_flat_snapshot bigint;

alter table public.orders
  drop column if exists service_fee_percent_snapshot;

comment on column public.merchants.service_fee_flat_idr is
  'Biaya layanan dalam rupiah, dibebankan ke pembeli dan dibayar langsung '
  'kepada merchant. Lacte tidak mengambil bagian dari nilai ini. Di-snapshot '
  'ke orders.service_fee_flat_snapshot saat checkout.';

-- ============================================================================
-- Self-registration: merchant DIDAFTARKAN SENDIRI oleh pemilik toko
-- ============================================================================
--
-- PENTING: pendaftaran mandiri membuat baris status pending, BUKAN
-- active. KEPUTUSAN PEMILIK: hanya admin yang boleh mengaktifkan toko.
--
-- Kalau langsung active, siapa pun bisa daftar dan langsung menerima
-- order: Lacte menanggung supplier_cost sejak merchant scan, dan
-- MAX_RECEIVABLE_IDR hanya membatasi PER TOKO. Jadi dengan daftar
-- otomatis, seratus toko palsu berarti eksposur seratus kali limit. Toko
-- palsu tidak akan pernah membayar, dan itu kerugian yang nyata dan
-- langsung.
--
-- pending tidak bisa:
--   - muncul di checkout (getActiveMerchants hanya active)
--   - dipakai memindai pesanan (authenticateMerchant menolak non-active)
--   - punya piutang, karena tanpa scan tidak ada order
--
-- Status pending juga tidak bisa diisi sendiri merchant: endpoint
-- pendaftaran dan endpoint dashboard sama-sama menolak menutup atau
-- mengedit baris miliknya sendiri. Satu-satunya jalan ke active adalah
-- PATCH /api/admin/merchants.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'merchants_status_check'
      and conrelid = 'public.merchants'::regclass
  ) then
    alter table public.merchants drop constraint merchants_status_check;
  end if;
end $$;

alter table public.merchants
  add constraint merchants_status_check
  check (status in ('pending', 'active', 'frozen', 'inactive'));

-- ============================================================================
-- Dashboard toko
-- ============================================================================
--
-- Dukung untuk pendaftaran mandiri.
--
-- `address` dan `contact` TIDAK ada di 036 karena waktu itu tidak ada jalur
-- pendaftaran mandiri. Keduanya sekarang wajib diisi pemohon: admin memakai
-- alamat untuk memverifikasi toko sungguhan sebelum menyetujui, jadi tanpa
-- alamat, antrean `pending` hanya berisi nama-nama tanpa jejak.
--
-- `code` dibuat server-side saat pendaftaran (prefix `TR` + 6 huruf), bukan
-- diminta dari pemohon. Kalau pemohon yang memilih, dia bisa membuat kode
-- yang mirip kode toko lain untuk mengelabui kasir.
alter table public.merchants
  add column if not exists address text;

alter table public.merchants
  add column if not exists contact text;

comment on column public.merchants.address is
  'Alamat toko. Wajib diisi saat pendaftaran mandiri, dipakai admin untuk '
  'memverifikasi sebelum menyetujui.';

comment on column public.merchants.contact is
  'Nomor HP/WA toko. Opsional, dipakai admin saat verifikasi.';

-- Dukung untuk halaman invoice toko. Tabel `merchant_payments` sudah ada
-- dari 036; yang ditambahkan hanya catatan kapan pelunasan dicatat, supaya
-- toko bisa melihat "terakhir diperbarui" tanpa menebak.
alter table public.merchant_payments
  add column if not exists recorded_at timestamptz not null default now();

-- Antrian pendaftaran perlu diurutkan.
create index if not exists merchants_pending_idx
  on public.merchants(created_at)
  where status = 'pending';