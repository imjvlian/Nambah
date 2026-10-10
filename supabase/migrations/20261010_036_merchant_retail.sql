-- 1.0.31 — Program merchant ritel (reseller dengan piutang).
--
-- Alur bisnis yang dimodelkan:
--
--   User ──(harga katalog + biaya layanan)──> Merchant
--   Merchant ──(scan kode)──> Lacte fulfill ke supplier
--   Merchant ──(transfer, dicatat admin)──> Lacte
--
-- PENTING: ini BUKAN payment method biasa. Pada jalur ini Lacte tidak
-- menerima pembayaran dari user sama sekali — user membayar langsung ke
-- merchant. Yang menjadi piutang Lacte adalah transfer merchant, dan itu
-- tercatat SESUDAH fulfillment terjadi.
--
-- Konsekuensi yang harus dipahami sebelum mengubah file ini:
--
-- 1. Lacte menanggung `supplier_cost` sejak order fulfilled sampai merchant
--    pays. Saldo Digiflazz terpakai lebih dulu. Ini risiko kas nyata, bukan
--    sekadar pembukuan.
--
-- 2. `nambah_profit` untuk order merchant SELALU 0 — biaya layanan 100%
--    milik merchant. Guard `minimumNambahProfit` (default 500) karena itu
--    harus di-bypass khusus jalur ini. Itu bukan bug, itu konsekuensi
--    model bisnis yang dipilih.
--
-- 3. Order `pending_merchant` TIDAK boleh ikut sweeper kedaluwarsa 30 menit
--    milik order Midtrans/DOKU. Setelah merchant scan, order sudah
--    irreversible di sisi supplier — membatalkannya tidak membatalkan
--    top up.
--
-- Semua akses lewat server (service role). RLS diaktifkan dan akses
-- `anon`/`authenticated` dicabut, sama seperti `admin_users` — tabel ini
-- berisi data hutang orang lain dan tidak boleh terbaca dari browser.

-- ============================================================================
-- merchants
-- ============================================================================

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  -- Kode yang dipindai merchant. Dipakai juga sebagai kredensial awal
  -- saat merchant belum punya akun Supabase. Unik karena ini yang
  -- menjadiETHOD kunci pencarian di halaman konfirmasi.
  code text not null unique,
  -- Biaya layanan yangditagihkan ke user, dalam persen dari harga katalog.
  -- 100% milik merchant: Lacte tidak mengambil apa pun dari nilai ini.
  -- Editable admin per merchant; NILAI INI DI-SNAPSHOT ke order saat
  -- checkout supaya perubahan admin tidak mengubah order yang sudah dibuat.
  service_fee_percent numeric(6,3) not null default 0
    check (service_fee_percent >= 0 and service_fee_percent <= 100),
  -- Masa tenggat pelunasan piutang, dalam hari. Default 7 sesuai
  -- keputusan bisnis; bisa diubah per merchant.
  payment_term_days integer not null default 7
    check (payment_term_days between 1 and 90),
  -- `frozen` menghentikan order BARU. Order yang sedang jalan tetap boleh
  -- diselesaikan — pengguna sudah-checkout dan tidak bisa disandera.
  status text not null default 'active'
    check (status in ('active', 'frozen', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merchants_status_idx on public.merchants(status);
create index if not exists merchants_user_idx on public.merchants(user_id);

-- ============================================================================
-- merchant_balances — piutang yang sedang berjalan
-- ============================================================================

create table if not exists public.merchant_balances (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  -- Total piutang belum lunas. TIDAK punya check >= 0: pelunasan melebihi
  -- piutang (sisa bayar,(kelebihan bayar) adalah hal nyata dan
  -- harus tercatat, bukan ditolak database.
  balance bigint not null default 0,
  -- Nilai order yang SUDAH dibuat tapi merchant belum scan.
  --
  -- Dipisah dari `balance` karena statusnya berbeda: `balance` adalah utang
  -- yang sudah jadi, sedangkan ini masih bisa batal. Tapi tidak boleh
  -- diabaikan saat cek kredit — merchant boleh scan tanpa transfer, jadi
  -- begitu discan Lacte yang menanggung. Kalau diabaikan, limit bisa
  -- ditembus berkali-kali dalam satu menit karena semua order baru dicek
  -- terhadap angka yang sama.
  pending_commitment bigint not null default 0,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_balance_snapshots (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  balance bigint not null,
  status text not null check (status in ('healthy', 'due_soon', 'overdue', 'unknown')),
  checked_at timestamptz not null default now()
);

create index if not exists merchant_balance_snapshots_lookup_idx
  on public.merchant_balance_snapshots(merchant_id, checked_at desc);

-- ============================================================================
-- merchant_payments — rekaman pelunasan oleh admin
-- ============================================================================

create table if not exists public.merchant_payments (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  -- Nominal yang dibayarkan merchant. Boleh melebihi piutang saat itu —
  -- itu sisa bayar yang akan mengurangi piutang order berikutnya.
  amount bigint not null check (amount > 0),
  method text not null default 'transfer'
    check (method in ('transfer', 'cash', 'other')),
  reference text,
  -- Dibiarkan null supaya pencatatan manual bisa masuk tanpa akun admin
  -- yang tertaut; `admin_users.user_id` harus nullable di tabel audit
  -- lain juga.
  recorded_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists merchant_payments_merchant_idx
  on public.merchant_payments(merchant_id, created_at desc);

-- ============================================================================
-- orders — kolom untuk jalur merchant
-- ============================================================================

alter table public.orders
  add column if not exists merchant_id uuid references public.merchants(id) on delete set null;

-- Snapshot fee saat checkout. WAJIB ada: kalau admin mengubah
-- `service_fee_percent` setelah user menekan tombol bayar, order yang sudah
-- dibuat harus tetap memakai nilai yang dilihat user di checkout. Tanpa
-- snapshot, piutang merchant dan nota user bisa berbeda.
alter table public.orders
  add column if not exists service_fee_percent_snapshot numeric(6,3);

alter table public.orders
  add column if not exists service_fee_amount bigint
  check (service_fee_amount is null or service_fee_amount >= 0);

-- Kapan piutang jatuh tempo. Diisi setelah fulfillment sukses.
alter table public.orders
  add column if not exists receivable_due_at timestamptz;

alter table public.orders
  add column if not exists receivable_paid_at timestamptz;

-- Status baru.
--
-- `pending_merchant` = user sudah checkout, menunggu merchant scan.
--   BUKAN `pending_payment` karena tidak ada yang bisa dibayar lewat
--   Midtrans/DOKU, dan expiry-nya berbeda.
--
-- `awaiting_receivable` = sudah fulfilled, piutang belum lunas. Order
--   dianggap SELESAI untuk user (menerima SN-nya), tapi uangnya belum
--   masuk ke Lacte.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'orders_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders drop constraint orders_status_check;
  end if;
end $$;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pending_payment', 'pending_merchant',
    'paid', 'processing',
    'success', 'awaiting_receivable',
    'failed', 'refunded', 'cancelled'
  ));

create index if not exists orders_merchant_receivable_idx
  on public.orders(merchant_id, receivable_due_at)
  where status = 'awaiting_receivable';

create index if not exists orders_pending_merchant_idx
  on public.orders(created_at)
  where status = 'pending_merchant';

-- ============================================================================
-- RLS — server-proxy only
-- ============================================================================

alter table public.merchants enable row level security;
alter table public.merchant_balances enable row level security;
alter table public.merchant_balance_snapshots enable row level security;
alter table public.merchant_payments enable row level security;

-- Akses lewat service role key dari server. `anon`/`authenticated` sengaja
-- dicabut: hutang merchant adalah data bisnis yang tidak boleh bisa dibaca
-- atau ditulis langsung dari browser, bahkan oleh merchant-nya sendiri —
-- semua lewat server route yang sudah diautentikasi.
revoke all on table public.merchants from anon, authenticated;
revoke all on table public.merchant_balances from anon, authenticated;
revoke all on table public.merchant_balance_snapshots from anon, authenticated;
revoke all on table public.merchant_payments from anon, authenticated;

grant all on table public.merchants to service_role;
grant all on table public.merchant_balances to service_role;
grant all on table public.merchant_balance_snapshots to service_role;
grant all on table public.merchant_payments to service_role;

-- Nama sequence hasil `generated always as identity` TIDAK dijamin Postgres —
-- ia bisa menamai ulang atau tidak membuatnya sama sekali kalau kolomnya
-- `generated ... stored`. Memberi grant dengan nama tebakan akan menggagalkan
-- seluruh migrasi.
--
-- Dipakai `ALTER DEFAULT PRIVILEGES` per skema, bukan nama sequence. Ini
-- benar karena sequence dibuat oleh service role saat `CREATE TABLE`
-- dijalankan di bawah hak yang sama.
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- ============================================================================
-- payment_method untuk jalur merchant
-- ============================================================================

-- Fee dibiarkan 0 di sini. Biaya layanan diambil dari
-- `merchants.service_fee_percent` saat checkout, bukan dari tabel ini —
-- supaya bisa berbeda per merchant.
--
-- `customer_fee` harus tetap 0 supaya harga di checkout = harga katalog +
-- fee merchant, dan `merchant_payment_cost` dibiarkan 0 karena Lacte tidak
-- membayar apa pun ke payment gateway untuk jalur ini.
-- `active = false` sampai admin mengaktifkannya. Jalur ini menyentuh saldo
-- supplier sebelum uang masuk, jadi tidak boleh muncul di checkout hanya
-- karena baris ini ada. Sama seperti `MERCHANT_RETAIL_ENABLED` di env.
insert into public.payment_methods (id, name, detail, customer_fee_flat, customer_fee_percent, merchant_fee_flat, merchant_fee_percent, active, sort_order)
values ('merchant_retail', 'Beli di Toko Ritel', 'Bayar langsung ke merchant', 0, 0, 0, 0, false, 90)
on conflict (id) do update set
  name = excluded.name,
  detail = excluded.detail;