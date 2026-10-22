-- ============================================================================
-- 060 - P2: affiliate tier 2 (upline)
--
-- Keputusan terkunci 22 Okt 2026 (lihat plan tier2-upline-build.md):
--   D1 pohon upline = customer_profiles.referred_by_id (depth-1 saja)
--   D3 commissions.tier (1|2) + unique (order_id, tier) — invariant
--      "satu baris per order" menjadi "satu baris per (order, tier)"
--   B4 rate tier-2 configurable: app_settings affiliate_tier2_rate (0.10)
--
-- Snapshot tier-2 di orders mengikuti pola snapshot tier-1 yang sudah ada
-- (affiliate_code/affiliate_rate/affiliate_commission): kolom diisi sekali
-- saat order dibuat (setelah guard B5), dibaca commission-service untuk
-- membuat baris komisi kedua. nambah_profit jadi
-- net_profit_before_affiliate - tier1 - tier2.
--
-- Idempoten. Baris komisi lama otomatis tier = 1 lewat DEFAULT kolom.
--
-- URUTAN RILIS (pola aman yang sudah terbukti): apply file ini DULU, lalu
-- langsung deploy kode. Drop unique order_id ada di langkah TERAKHIR
-- supaya kode lama (upsert onConflict "order_id") tetap aman selama
-- mungkin — dan jendela antara drop sampai deploy baru harus sesingkat
-- mungkin. Sync komisi bersifat state-based (baca state order, bukan
-- event), sehingga kalau ada transisi yang kehilangan sync di jendela
-- itu, panggilan sync berikutnya menyembuhkannya sendiri.
-- ============================================================================

-- (1) Pohon upline: siapa yang mengarahkan user ini. First-touch menang —
-- kolom ini hanya ditulis saat profil dibuat pertama kali (atau oleh admin);
-- tidak pernah ditimpa simpanan profil berikutnya.
alter table public.customer_profiles
  add column if not exists referred_by_id uuid
    references auth.users(id) on delete set null;

alter table public.customer_profiles
  drop constraint if exists customer_profiles_referred_by_not_self_check;

alter table public.customer_profiles
  add constraint customer_profiles_referred_by_not_self_check
    check (referred_by_id is null or referred_by_id <> user_id);

-- (2) Komisi dua tier: tier 1 = pemilik kode, tier 2 = upline-nya.
-- Kolom + unique composite ditambah lebih dulu; drop unique lama
-- sengaja di langkah (6), paling akhir.
alter table public.commissions
  add column if not exists tier smallint not null default 1
    check (tier in (1,2));

alter table public.commissions
  drop constraint if exists commissions_order_tier_key;

alter table public.commissions
  add constraint commissions_order_tier_key
    unique (order_id, tier);

-- (3) Snapshot tier-2 di orders — pola yang sama dengan kolom affiliate_*.
-- NULL = tidak ada upline / tier-2 tidak berlaku untuk order ini.
alter table public.orders
  add column if not exists tier2_affiliate_code text
    references public.affiliates(code) on delete set null;

alter table public.orders
  add column if not exists tier2_rate numeric(10,6)
    check (tier2_rate is null or (tier2_rate >= 0 and tier2_rate <= 1));

alter table public.orders
  add column if not exists tier2_commission bigint
    check (tier2_commission is null or tier2_commission >= 0);

-- (4) Rate default (B4) — jsonb number, dibaca route sebagai number.
insert into public.app_settings (key, value)
values ('affiliate_tier2_rate', to_jsonb(0.10))
on conflict (key) do nothing;

-- (5) Sejajarkan baris lama: semua komisi yang sudah ada adalah tier 1.
-- DEFAULT 1 sebenarnya sudah menutupi ini saat kolom ditambah; update
-- eksplisit menjaga baris yang mungkin tertulis nilai aneh dari uji coba.
update public.commissions set tier = 1
where tier is distinct from 1;

-- (6) TERAKHIR, sesudah unique composite aman berdiri: lepas unique
-- order_id tunggal. Mulai titik ini kode LAMA (onConflict "order_id")
-- tidak bisa lagi upsert — deploy kode baru segera setelah apply.
alter table public.commissions
  drop constraint if exists commissions_order_id_key;
