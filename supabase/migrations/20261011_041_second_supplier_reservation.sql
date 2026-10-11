-- ============================================================================
-- 041 - supplier kedua, registrasi, dan reservasi saldo atomik
-- ============================================================================
--
-- Tahap 1 (abstraksi supplier) sudah menyisakan satu hal yang tidak bisa
-- diselesaikan di aplikasi: penguncian saldo.
--
-- MASALAH YANG DIINI
--
-- Nambah memilih supplier saat order dibuat, bukan saat eksekusi. Itu
-- supaya harga di nota sama dengan yang dibayar pembeli. Konsekuensinya,
-- saldo supplier harus dikunci saat itu juga - kalau tidak, dua order yang
-- datang bersamaan bisa membaca saldo yang sama lalu memilih supplier yang
-- sama, dan order kedua akan ditolak supplier SETELAH uang masuk.
--
-- MENGAPA BUTUH FUNGSI, BUKAN DUA PANGGILAN DARI APLIKASI
--
-- "baca saldo, cek cukup, lalu tulis" punya celah di antaranya. Dua request
-- paralel bisa dua-duanya membaca saldo yang sama sebelum salah satunya
-- menulis. PostgREST juga tidak bisa membandingkan antar kolom di filter,
-- jadi `?balance-reserved_balance=gte.60000` tidak bisa dipakai.
--
-- Satu `update ... where` di dalam satu transaksi Postgres bersifat atomik:
-- hanya satu dari dua request paralel yang akan lolos. Itu yang dilakukan
-- ketiga fungsi di bawah.
--
-- SATU-SATUNYA CARA RESERVASI YANG AMAN: PANGGIL SATU-SATUNYA
--
-- Fungsi-fungsi ini sengaja TIDAK bisa dipanggil lewat filter PostgREST
-- biasa. Aplikasi wajib memanggilnya lewat RPC dengan nilai yang sudah
-- dihitung server. Melewati satu reservasi berarti saldo terkunci
-- permanen tanpa order yang menggantunginya, dan tidak ada error yang
-- akan terlihat - saldo hanya terlihat "kurang" tanpa penjelasan.
--
-- Catatan untuk `checkDigiflazzSupplierBalance`: fungsi itu menyalin
-- `reserved_balance` dari baris lama saat menyegarkan saldo. Itu aman
-- selama reservasi lewat RPC dipakai - nilainya yang disalin, bukan
-- dihapus. Tapi kalau ada jalur lain yang menulis `supplier_balances`
-- langsung, ia bisa menimpa reservasi yang sedang berjalan. Semua
-- penambahan reservasi WAJIB lewat `reserve_supplier_balance`.

-- ============================================================================
-- 1. Supplier terdaftar
-- ============================================================================
-- Bentuk tabel sudah multi-supplier dari awal, jadi di sini hanya mengisi
-- barisnya. `on conflict do nothing` supaya migrasi ini aman dijalankan
-- ulang, dan aman dijalankan di database yang sudah punya 'digiflazz'
-- dari seed sebelumnya.

insert into public.suppliers (id, name)
values
  ('digiflazz', 'Digiflazz'),
  ('melostore', 'Melostore')
on conflict (id) do nothing;

-- ============================================================================
-- 2. reserve_supplier_balance
-- ============================================================================
-- Menaikkan reserved_balance HANYA kalau saldonya cukup.
--
-- Guard `p_amount <= 0` ada di awal, bukan di dalam `where`. Tanpa itu,
-- panggilan dengan amount negatif akan mengurangi reserved_balance dan
-- membuat check constraint `reserved_balance <= balance` lolos dengan
-- angka yang salah - constraint yang tidak lagi mencerminkan kenyataan.

create or replace function public.reserve_supplier_balance(
  p_supplier_id text,
  p_amount bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;

  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    return false;
  end if;

  -- Baris saldo mungkin belum ada untuk supplier yang baru ditambahkan.
  -- Tanpa insert di sini, pemanggilan pertama akan selalu gagal dan
  -- gejalanya "saldo selalu 0", bukan "supplier belum punya baris saldo".
  insert into public.supplier_balances (supplier_id, balance, reserved_balance)
  values (p_supplier_id, 0, 0)
  on conflict (supplier_id) do nothing;

  update public.supplier_balances
     set reserved_balance = reserved_balance + p_amount,
         updated_at = now()
   where supplier_id = p_supplier_id
     and balance - reserved_balance >= p_amount;

  return found;
end;
$$;

comment on function public.reserve_supplier_balance(text, bigint) is
  'Naikkan reserved_balance secara atomik HANYA kalau saldo bebas cukup. '
  'Return true kalau berhasil, false kalau tidak. Satu-satunya cara '
  'menambah reservasi - jangan menulis supplier_balances langsung.';

-- ============================================================================
-- 3. commit_supplier_reservation
-- ============================================================================
-- Transaksi supplier sukses: uang benar-benar keluar dari saldo supplier.
-- reserved_balance turun (kunci dilepas) DAN balance turun (uang keluar).
--
-- Keduanya dalam satu statement supaya tidak pernah ada keadaan di mana
-- reserved sudah lepas tapi balance belum turun - yang akan membuat saldo
-- terlihat lebih besar dari kenyataan dan membuka jalan order yang tidak
-- akan dibayar supplier.

create or replace function public.commit_supplier_reservation(
  p_supplier_id text,
  p_amount bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;

  update public.supplier_balances
     set reserved_balance = greatest(0, reserved_balance - p_amount),
         balance = greatest(0, balance - p_amount),
         updated_at = now()
   where supplier_id = p_supplier_id
     and reserved_balance >= p_amount
     and balance >= p_amount;

  return found;
end;
$$;

comment on function public.commit_supplier_reservation(text, bigint) is
  'Lepas reservasi DAN kurangi saldo setelah transaksi supplier sukses. '
  'Return false kalau saldo atau reservasi tidak cukup - yang biasanya '
  'berarti saldo lokal tidak sinkron dengan reality supplier.';

-- ============================================================================
-- 4. release_supplier_reservation
-- ============================================================================
-- Transaksi gagal, atau order dibatalkan / kedaluwarsa.
--
-- HANYA reserved_balance yang turun. Balance tidak boleh disentuh: uang
-- supplier sudah dikembalikan oleh supplier, dan_balance_ lokal akan
-- disegarkan kembali oleh job cek saldo. Mengurangi dua-duanya akan
-- menghormati saldo dua kali dan membuat Lacto terlihat kehilangan uang
-- yang sebenarnya sudah kembali.
--
-- `greatest(0, ...)` menjaga supaya pemanggilan ganda tidak membuat
-- reserved_balance negatif. Idempoten dalam arah yang salah - pemanggilan
-- kedua tidak merusak angka, tapi juga tidak menambah pengembalian.

create or replace function public.release_supplier_reservation(
  p_supplier_id text,
  p_amount bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;

  update public.supplier_balances
     set reserved_balance = greatest(0, reserved_balance - p_amount),
         updated_at = now()
   where supplier_id = p_supplier_id;

  return found;
end;
$$;

comment on function public.release_supplier_reservation(text, bigint) is
  'Lepas reservasi TANPA mengurangi saldo. Untuk transaksi gagal, order '
  'batal, dan order kedaluwarsa. Hanya reserved_balance yang turun - '
  'saldo lokal disegarkan terpisah oleh job cek saldo.';

-- ============================================================================
-- 5. grant ke peran yang dipakai PostgREST
-- ============================================================================
-- Tanpa grant, PostgREST mendapat PGRST403 saat memanggil RPC - pesan yang
-- menyebut permission, sementara penyebabnya adalah baris `grant` yang
-- tidak ada.-traveling perannya sudah dipakai service_role di file lain,
-- jadi ikut pola yang sama.

-- REVOKE DULU, BARU GRANT.
--
-- Fungsi-fungsi ini `security definer`: tanpa `revoke`, Postgres
-- memberi EXECUTE ke PUBLIC secara default, dan PostgREST mengekspos
-- setiap fungsi di skema public. Artinya siapa pun yang punya anon key
-- -termasuk kode di browser- bisa mengunci saldo supplier atau
-- melepas reservasi milik orang lain. `revoke` menutup itu; `grant`
-- lalu membukanya kembali khusus untuk service_role.
--
-- Urutannya penting: revoke dulu, baru grant.

revoke all on function public.reserve_supplier_balance(text, bigint) from public, anon, authenticated;
revoke all on function public.commit_supplier_reservation(text, bigint) from public, anon, authenticated;
revoke all on function public.release_supplier_reservation(text, bigint) from public, anon, authenticated;

grant execute on function public.reserve_supplier_balance(text, bigint) to service_role;
grant execute on function public.commit_supplier_reservation(text, bigint) to service_role;
grant execute on function public.release_supplier_reservation(text, bigint) to service_role;