-- 027: Taksonomi kategori produk yang lebih spesifik.
--
-- games.category lama hanya dibatasi CHECK constraint ke 'game'/'voucher',
-- sehingga storefront harus menebak jenis produk dari teks (rapuh).
-- Migrasi ini memperluas constraint dan mengisi nilai yang spesifik:
--   game | pulsa-data | e-wallet | pln | langganan | voucher | digital
--
-- Setelah migrasi ini dijalankan, storefront memakai nilai DB langsung
-- (src/components/CategorizedTopupExperience.tsx).

-- 1) Lepas CHECK constraint lama (nama dicari dinamis, aman diulang).
do $$
declare
  v_constraint text;
begin
  select con.conname into v_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where rel.relname = 'games'
    and nsp.nspname = 'public'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%category%'
  limit 1;

  if v_constraint is not null then
    execute format('alter table public.games drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.games
  add constraint games_category_check
  check (category in (
    'game', 'pulsa-data', 'e-wallet', 'pln', 'langganan', 'voucher', 'digital'
  ));

-- 2) Game yang sebelumnya salah impersonal sebagai voucher.
update public.games set category = 'game'
where id in ('valorant', 'roblox', 'efootball');

-- 3) Operator telco -> Pulsa & Data.
update public.games set category = 'pulsa-data'
where id in ('axis', 'by-u', 'indosat', 'telkomsel', 'tri', 'xl', 'smartfren');

-- 4) E-money -> E-Wallet.
update public.games set category = 'e-wallet'
where id in ('dana', 'ovo', 'go-pay', 'shopee-pay');

-- 5) Token listrik -> PLN.
update public.games set category = 'pln'
where id in ('pln');

-- 6) TV berbayar & streaming -> Langganan.
update public.games set category = 'langganan'
where id in ('vidio', 'k-vision-dan-gol');

-- 7) Tagihan/utilitas -> Digital.
update public.games set category = 'digital'
where id in ('pertamina-gas');

-- Tetap 'voucher' (sudah benar): steam-wallet, steam-wallet-idr,
-- google-play-indonesia, playstation, xbox, garena.