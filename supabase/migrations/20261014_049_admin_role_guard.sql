-- ============================================================================
-- 049 - Pengaman lockout untuk perubahan role akun admin.
--
-- MASALAH
--
-- `admin_users` adalah satu-satunya sumber akses dashboard. Kalau baris
-- terakhir yang punya role superadmin aktif dinonaktifkan, TIDAK ADA jalan
-- masuk lagi: `session/route.ts` menolak siapa pun yang tidak tercatat di
-- tabel ini, dan satu-satunya superadmin yang tersisa adalah akun yang
-- sedang dinonaktifkan. Pulihannya harus lewat SQL manual di server.
--
-- MENGAPA DI DALAM DATABASE, BUKAN DI ROUTE
--
-- Dua superadmin yang saling menonaktifkan di detik yang sama masing-masing
-- akan menghitung "masih ada dua". Keduanya lolos. Hasilnya nol superadmin -
-- dan tidak ada yang salah di salah satu request, keduanya memang terlihat
-- benar saat dijalankan. Pemeriksaan di route hanya melindungi dari klik
-- tidak sengaja, bukan dari dua klik bersamaan.
--
-- `FOR UPDATE` membuat request kedua BERHENTI di baris yang sama sampai
-- transaksi pertama selesai, lalu menghitung ulang di atas data yang sudah
-- diperbarui. Itulah alasan kuncinya diambil sebelum dihitung.
--
-- YANG DICEGAH HANYA SATU KEADAAN
--
-- Aturannya satu: tidak boleh ada nol superadmin aktif. Promote akun non-
-- superadmin, menghidupkan kembali akun yang dinonaktifkan, dan mengganti
-- role admin biasa semuanya bebas.
--
-- Refund dan proses lain yang menyentuh `admin_users` TIDAK lewat fungsi ini,
-- jadi tidak ikut terlindungi. Kalau nanti ada jalur lain - misalnya
-- penghapusan akun - jalurnya harus memanggil fungsi yang sama.
-- ============================================================================

create or replace function public.nambah_set_admin_role(
  p_user_id uuid,
  p_role text,
  p_active boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.admin_users%rowtype;
  v_active_superadmins integer;
begin
  if p_user_id is null then
    raise exception 'Akun admin tujuan wajib diisi.';
  end if;

  if p_role is null or p_role not in ('admin', 'superadmin') then
    raise exception 'Role admin harus admin atau superadmin.';
  end if;

  /*
   * Kunci baris superadmin yang SEDANG AKTIF.
   *
   * Dipilih hanya yang aktif supaya kuncinya sempit: demote admin biasa
   * tidak ikut memblokir promote orang lain. Tapi begitu ada operasi yang
   * menyentuh superadmin aktif, setiap operasi sejenis antre di baris yang
   * sama - dan barulah setelah antre itu jumlah dihitung ulang.
   */
  perform 1
  from public.admin_users
  where role = 'superadmin' and active
  for update;

  select count(*)::integer
  into v_active_superadmins
  from public.admin_users
  where role = 'superadmin' and active;

  /*
   * Kehilangan superadmin aktif terakhir DITOLAK.
   *
   * Superadmin bisa hilang lewat dua jalan: dinonaktifkan, atau diturunkan
   * rolenya jadi admin biasa. Keduanya mengurangi jumlah yang sama, jadi
   * keduanya harus diperiksa - kalau hanya `not p_active` yang diperiksa,
   * menurunkan superadmin terakhir ke admin biasa akan lolos dan sistem
   * akan punya nol superadmin tanpa ada yang menyadari apa pun.
   *
   * Syarat `exists` di akhir itu penting: tanpa itu, demote admin biasa
   * akan ikut ditolak saat hanya ada satu superadmin, padahal yang
   * hilang bukan superadmin itu.
   */
  if (not p_active or p_role <> 'superadmin')
     and v_active_superadmins <= 1
     and exists (
       select 1 from public.admin_users
       where user_id = p_user_id
         and role = 'superadmin'
         and active
     ) then
    raise exception
      'Ini superadmin aktif terakhir. Menonaktifkannya akan menutup akses dashboard untuk semua orang.';
  end if;

  select * into v_current
  from public.admin_users
  where user_id = p_user_id
  for update;

  if found and v_current.role = p_role and v_current.active = p_active then
    return jsonb_build_object(
      'userId', p_user_id,
      'role', p_role,
      'active', p_active,
      'changed', false,
      'activeSuperadmins', v_active_superadmins
    );
  end if;

  insert into public.admin_users(user_id, role, active, created_at, updated_at)
  values (p_user_id, p_role, p_active, now(), now())
  on conflict (user_id) do update
    set role = excluded.role,
        active = excluded.active,
        updated_at = now()
  returning * into v_current;

  return jsonb_build_object(
    'userId', v_current.user_id,
    'role', v_current.role,
    'active', v_current.active,
    'changed', true,
    'activeSuperadmins', v_active_superadmins
  );
end;
$$;

revoke all on function public.nambah_set_admin_role(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.nambah_set_admin_role(uuid, text, boolean)
  to service_role;

comment on function public.nambah_set_admin_role(uuid, text, boolean) is
  'Mengubah role atau status aktif akun admin. Menolak perubahan yang akan '
  'menyisakan nol superadmin aktif - pemeriksaannya di dalam transaksi '
  'supaya dua permintaan bersamaan tidak bisa saling mengunci dashboard.';

-- Daftar admin sekaligus penghitung superadmin aktif.
--
-- Satu sumber angka untuk UI DAN aturan, supaya tombol di layar tidak
-- menampilkan keadaan yang berbeda dari yang akan dicek database.
create or replace view public.admin_users_with_counts as
select
  u.user_id,
  u.role,
  u.active,
  u.created_at,
  u.updated_at,
  (select count(*)::integer
   from public.admin_users s
   where s.role = 'superadmin' and s.active) as active_superadmins
from public.admin_users u;

revoke all on public.admin_users_with_counts from anon, authenticated;
grant select on public.admin_users_with_counts to service_role;

comment on view public.admin_users_with_counts is
  'Daftar akun admin beserta jumlah superadmin aktif. Nilai active_superadmins '
  'sama persis untuk semua baris - dipakai UI untuk memblokir aksi yang akan '
  'menyisakan nol superadmin sebelum request dikirim.';