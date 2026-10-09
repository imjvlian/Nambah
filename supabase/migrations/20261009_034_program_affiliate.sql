-- 034: Program affiliate mandiri - request, link, dan pelacakan klik.
--
-- LANJUTAN: kolom link channel ditambahkan di `20261009_035_social_links.sql`.
-- File ini sudah dijalankan, jadi TIDAK diubah — lihat 035.
--
-- Yang sudah ada sebelum file ini dan TIDAK diubah:
--   affiliates, commissions, affiliate_withdrawals
--   route /api/admin/affiliates (CRUD), /api/account/affiliate (ringkasan)
--   komisi dihitung di `order-service.ts` dari `net_profit_before_affiliate`
--
-- Yang ditambahkan di sini:
--   1. status `pending` — supaya permintaan affiliate bisa ditampung
--   2. `affiliate_requests` — request dari pembeli
--   3. `affiliate_clicks` — pelacakan klik link per sesi, untuk konversi
--
-- Affiliate lama (`ZACKY5`, `CREATOR`) sengaja TIDAK dimigrasi. Keduanya tetap
-- berfungsi seperti sebelumnya: `status` dan `commission_rate` tidak berubah.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Status `pending` untuk affiliate.
--
-- Constraint lama hanya menerima 'active','inactive','suspended'. Tanpa
-- 'pending', permintaan dari pembeli tidak punya tempat dan akan langsung
-- jadi affiliate aktif — memberi komisi ke siapa saja yang request.
--
-- Status `pending` hanya dipakai pada tabel `affiliate_requests`; baris di
-- `affiliates` yang berstatus `pending` tidak pernah dibuat. Kolomnya hanya
-- disiapkan supaya satu akun tidak bisa punya dua affiliate (dijamin unique
-- index di bawah), dan supaya approve punya tempat menulis statusnya.
alter table public.affiliates
  drop constraint if exists affiliates_status_check;

alter table public.affiliates
  add constraint affiliates_status_check
  check (status in ('pending', 'active', 'inactive', 'suspended'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Permintaan jadi affiliate.
--
-- `user_id` UNIQUE: satu akun hanya boleh punya satu permintaan. Tanpa ini
-- user bisaspam request dan membanjiri antrean review admin.
--
-- Constraint `status` membuat nilai di luar ('pending','approved','rejected')
-- mustahil — termasuk kalau ada bug di sisi aplikasi yang menambah request
-- dengan status sembarangan.
create table if not exists public.affiliate_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null unique,
  display_name text not null,
  whatsapp text not null default '',
  motivation text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  -- Kode affiliate yang dihasilkan saat disetujui. NULL kalau ditolak.
  granted_code text references public.affiliates(code) on delete set null,
  commission_rate numeric(10,6),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Antrean review: yang pending dulu, lalu yang sudah diputuskan.
create index if not exists affiliate_requests_status_created_idx
  on public.affiliate_requests(status, created_at desc);

alter table public.affiliate_requests enable row level security;
revoke all on public.affiliate_requests from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Pelacakan klik.
--
-- `session_key` berasal dari cookie yang dibuat `/r/[code]`. Unik di
-- `(code, session_key)` supaya klik kedua dari orang yang sama tidak dihitung
-- lagi — inilah yang membuat "klik 1" bekerja.
--
-- CATATAN KEAMANAN, dibaca sebelum mengubah apa pun di sini:
-- session_key bukan pengenal yang kuat.Siapa pun bisa menghapus cookie-nya, dan
-- setelah itu cooldown serta hitungan klik tidak mengenali dia lagi. Ini
-- keputusan yang disengaja (bukan IP, yang menyakiti pengguna sah yang
-- berbagi IP di kos/kantor/seluler), tapi berarti:
--   - ini PENCEGAHAN RINGAN, bukan perlindungan
--   - tidak boleh dipakai sebagai satu-satunya alasan menolak order
-- Tuba yang tersedia untuk mendeteksi penyalahgunaan: laporan "klik 20,
-- pesanan 1" per affiliate di monitor.
--
-- `user_id` nullable: klik bisa terjadi sebelum orang login — memang itu
-- tujuannya, supaya tamu tetap bisa memicu komisi lewat link.
create table if not exists public.affiliate_clicks (
  id bigint generated always as identity primary key,
  affiliate_code text not null references public.affiliates(code) on delete cascade,
  session_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  clicked_at timestamptz not null default now(),
  constraint affiliate_clicks_unique_per_session unique (affiliate_code, session_key)
);

create index if not exists affiliate_clicks_code_time_idx
  on public.affiliate_clicks(affiliate_code, clicked_at desc);

alter table public.affiliate_clicks enable row level security;
revoke all on public.affiliate_clicks from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Fungsi bantu: apakah user ini masih dalam cooldown 24 jam untuk AFFILIATE
--    tertentu?
--
-- Yang dikunci adalah AFFILIATE, bukan kodenya. Affiliate yang punya dua kode
-- (misalnya kode lama dan kode baru) tetap dihitung sebagai satu affiliate —
-- kalau dikunci per kode, ganti kode akan lolos dari cooldown.
--
-- Hanya order `success` yang dihitung:
--   - `pending_payment` bisa berjam-jam tidak dibayar lalu dibatalkan
--   - `failed` / `cancelled` / `refunded` tidak menghasilkan komisi
-- Kalau status lain ikut dihitung, affiliate bisa memicu cooldown-nya dengan
-- order yang tak pernah dibayar.
--
-- Order tanpa kode affiliate tidak masuk, dan order tanpa `user_id` tidak
-- dihitung — pemanggil harus memutuskan sendiri apa yang dilakukan untuk
-- tamu (lihat catatan di `src/lib/affiliate-attribution.ts`).
create or replace function public.affiliate_cooldown_active(
  p_user_id uuid,
  p_affiliate_code text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    join public.affiliates a on a.code = o.affiliate_code
    where o.customer_user_id = p_user_id
      and a.code = p_affiliate_code
      and o.status = 'success'
      and o.created_at > now() - interval '24 hours'
  );
$$;

revoke all on function public.affiliate_cooldown_active(uuid, text) from public;

-- ─────────────────────────────────────────────────────────────────────────
-- Verifikasi setelah dijalankan:
--
--   select status, count(*) from public.affiliate_requests group by status;
--   -- harus kosong: belum ada request
--
--   select count(*) from public.affiliate_clicks;
--   -- harus 0
--
--   select id, code, status, commission_rate from public.affiliates order by code;
--   -- ZACKY5 dan CREATOR harus tetap sama seperti sebelumnya
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.affiliates'::regclass and conname = 'affiliates_status_check';
--   -- harus memuat 'pending'
