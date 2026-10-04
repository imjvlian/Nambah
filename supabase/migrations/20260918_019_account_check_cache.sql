-- Nambah 0.5.1 - durable account-check cache.
--
-- Hasil pengecekan akun dari provider (Volsever / Mimih) disimpan supaya user
-- yang mengetik User ID sama tidak memicu panggilan provider eksternal lagi.
-- Ini murni lapisan performa: kalau cache miss, alur pengecekan tetap berjalan
-- persis seperti sebelumnya, dan error cache tidak boleh menggagalkan check.
--
-- Hanya hasil BERHASIL (nickname ditemukan) yang disimpan. Hasil "tidak
-- ditemukan" sengaja tidak di-cache supaya user yang baru membuat akun
-- tidak terjebak negative cache.

create table if not exists public.account_check_cache (
  game_id text not null,
  user_id text not null,
  server_id text not null default '',
  nickname text not null,
  resolved_server text,
  region text,
  provider text not null check (provider in ('volsever', 'mimih')),
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (game_id, user_id, server_id)
);

-- Dipakai cleanup baris kedaluwarsa (dipanggil dari cron reconcile).
create index if not exists account_check_cache_expires_idx
  on public.account_check_cache(expires_at);

alter table public.account_check_cache enable row level security;
revoke all on table public.account_check_cache from anon, authenticated;

comment on table public.account_check_cache is
  'Server-only cache of successful game account checks (nickname/region) to avoid repeat provider calls.';