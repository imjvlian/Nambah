
-- 050 - Agregat pesanan per customer untuk halaman admin "Pengguna".
--
-- MASALAH
--
-- Halaman admin menyusun daftar customer dari `customer_profiles` union
-- `orders.customer_user_id`, lalu menghitung jumlah pesanan dan total
-- belanja di JavaScript. Dua batas tersembunyi muncul dari cara itu:
--
-- 1. `orders` diambil dengan `limit: 5000` diurutkan terbaru. Order yang
--    lebih lama dari 5000 terakhir TIDAK ikut dihitung, sehingga user-nya
--    tampil dengan angka yang salah - dan tidak ada apa pun yang
--    mengalarm bahwa angkanya bukan angka sebenarnya.
-- 2. Akun yang daftar tapi belum pernah membuat profil dan belum pernah
--    order tidak muncul sama sekali, karena daftar dibangun dari profil dan
--    order saja. Sumber kebenaran sebenarnya - daftar akun di Supabase Auth -
--    diambil, tapi hanya dipakai mencari email.
--
-- SOLUSI
--
-- Agregat dipindahkan ke Postgres. Tidak ada lagi batas 5000 baris, dan
-- database yang memutuskan angka, bukan loop di memori server.
--
-- TETAP SATU-SATUNYA SUMBER DAFTAR AKUN
--
-- Fungsi ini hanya mengembalikan statistik. Siapa yang terdaftar tetap
-- urusan Supabase Auth - jadi tabel ini sengaja tidak mengembalikan daftar
-- user, supaya tidak ada tempat kedua yang bisa jadi sumber kebenaran.
-- ============================================================================

create or replace function public.nambah_customer_order_stats()
returns table (
  user_id uuid,
  orders bigint,
  success bigint,
  spend bigint,
  last_order_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.customer_user_id,
    count(*)::bigint,
    count(*) filter (where o.status = 'success')::bigint,
    coalesce(sum(o.final_price) filter (where o.status = 'success'), 0)::bigint,
    max(o.created_at)
  from public.orders o
  where o.customer_user_id is not null
  group by o.customer_user_id;
$$;

revoke all on function public.nambah_customer_order_stats()
  from public, anon, authenticated;
grant execute on function public.nambah_customer_order_stats()
  to service_role;

comment on function public.nambah_customer_order_stats() is
  'Agregat pesanan per customer: jumlah order, order sukses, total belanja '
  'dari order sukses, dan pesanan terakhir. Dipanggil halaman admin '
  'Pengguna supaya tidak ada lagi batas baris yang memotong hasil diam-diam.';