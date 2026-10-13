-- ============================================================================
-- 047 - Komisi afiliasi baru bisa dicairkan 3 hari setelah order sukses.
--
-- ATURAN
--
-- Komisi berstatus 'available' sejak order sukses, tapi "tersedia untuk
-- dicairkan" kini menunggu 3 hari dari momen itu (available_at, dengan
-- fallback created_at untuk komisi lama yang available_at-nya null).
-- Alasannya bisnis, bukan teknis: 3 hari adalah jendela refund/komplain
-- order - mencairkan komisi sebelum jendela itu lewat berarti mengirim
-- uang untuk order yang masih bisa dibatalkan.
--
-- SATU DEFINISI, TIGA PEMAKAI
--
-- Saldo "bisa dicairkan" dihitung di dua RPC dan satu reduce JS admin.
-- Ketiganya WAJIB memakai rumus sama; kalau satu saja beda, afiliator
-- melihat "Tersedia Rp X" lalu permintaannya ditolak - keadaan yang
-- tidak bisa dijelaskan dari layar.
--
-- FILTER WAKTU, BUKAN STATUS BARU
--
-- Tidak ada status 'maturing' dan tidak ada cron yang memindahkan baris:
-- status berarti keadaan PERMANEN order, bukan umur. Filter waktu
-- deterministik - komisi yang sama menghitung sama hari ini dan besok,
-- tanpa job yang bisa telat.
-- ============================================================================

-- 1. nambah_affiliate_request_withdrawal: saldo yang boleh dicairkan
--    + loop alokasi FIFO - keduanya disaring masa 3 hari.
create or replace function public.nambah_affiliate_request_withdrawal(
  p_user_id uuid,
  p_amount bigint,
  p_method text,
  p_account_name text,
  p_account_number text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_affiliate_code text;
  v_withdrawal_id bigint;
  v_needed bigint;
  v_available bigint := 0;
  v_commission record;
  v_reserved bigint;
  v_take bigint;
begin
  if p_amount <= 0 then
    raise exception 'Nominal withdrawal harus lebih dari 0.';
  end if;

  if length(trim(coalesce(p_method,''))) < 2
     or length(trim(coalesce(p_account_name,''))) < 2
     or length(trim(coalesce(p_account_number,''))) < 4 then
    raise exception 'Data rekening withdrawal belum lengkap.';
  end if;

  select code into v_affiliate_code
  from public.affiliates
  where user_id = p_user_id and status = 'active'
  for update;

  if v_affiliate_code is null then
    raise exception 'Akun ini belum terhubung ke affiliate aktif.';
  end if;

  if exists (
    select 1 from public.affiliate_withdrawals
    where affiliate_code = v_affiliate_code
      and status in ('pending','approved')
  ) then
    raise exception 'Masih ada withdrawal yang sedang diproses.';
  end if;

  /*
   * MASA 3 HARI: komisi hanya bisa dicairkan setelah
   * coalesce(available_at, created_at) <= now() - interval '3 days'.
   * coalesce wajib: komisi lama bisa punya available_at null, dan
   * membiarkannya null berarti tidak pernah lolos perbandingan -
   * komisi itu terjebak tidak bisa dicairkan selamanya.
   */
  select coalesce(sum(
    greatest(0, c.amount - coalesce((
      select sum(a.amount)
      from public.affiliate_withdrawal_allocations a
      join public.affiliate_withdrawals w on w.id = a.withdrawal_id
      where a.commission_id = c.id
        and w.status in ('pending','approved','paid')
    ),0))
  ),0)
  into v_available
  from public.commissions c
  where c.affiliate_code = v_affiliate_code
    and c.status = 'available'
    and coalesce(c.available_at, c.created_at) <= now() - interval '3 days';

  if p_amount > v_available then
    if (
      select coalesce(sum(c.amount), 0)
      from public.commissions c
      where c.affiliate_code = v_affiliate_code
        and c.status = 'available'
    ) >= p_amount then
      raise exception
        'Komisi baru bisa dicairkan 3 hari setelah order sukses. Sebagian saldo masih dalam masa tunggu.';
    end if;
    raise exception 'Saldo affiliate tersedia tidak mencukupi.';
  end if;

  insert into public.affiliate_withdrawals(
    affiliate_code, amount, method, account_name, account_number,
    status, requested_at, created_at, updated_at
  )
  values(
    v_affiliate_code,
    p_amount,
    left(trim(p_method),80),
    left(trim(p_account_name),120),
    left(trim(p_account_number),120),
    'pending',
    now(),
    now(),
    now()
  )
  returning id into v_withdrawal_id;

  v_needed := p_amount;

  for v_commission in
    select id, amount
    from public.commissions
    where affiliate_code = v_affiliate_code
      and status = 'available'
      and coalesce(available_at, created_at) <= now() - interval '3 days'
    order by available_at asc nulls last, id asc
    for update
  loop
    select coalesce(sum(a.amount),0)
    into v_reserved
    from public.affiliate_withdrawal_allocations a
    join public.affiliate_withdrawals w on w.id = a.withdrawal_id
    where a.commission_id = v_commission.id
      and w.status in ('pending','approved','paid');

    v_take := least(v_needed, greatest(0, v_commission.amount - v_reserved));

    if v_take > 0 then
      insert into public.affiliate_withdrawal_allocations(
        withdrawal_id, commission_id, amount
      )
      values(v_withdrawal_id, v_commission.id, v_take);
      v_needed := v_needed - v_take;
    end if;

    exit when v_needed = 0;
  end loop;

  if v_needed > 0 then
    raise exception 'Allocation commission tidak konsisten.';
  end if;

  return jsonb_build_object(
    'withdrawalId', v_withdrawal_id,
    'affiliateCode', v_affiliate_code,
    'amount', p_amount,
    'status', 'pending'
  );
end;
$$;

-- 2. nambah_affiliate_summary: available = hanya yang sudah lewat 3 hari;
--    komisi 'available' yang belum lewat dilaporkan sebagai 'maturing'
--    supaya afiliator melihat di mana uangnya, bukan merasa hilang.
create or replace function public.nambah_affiliate_summary(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_pending bigint := 0;
  v_available bigint := 0;
  v_maturing bigint := 0;
  v_reserved bigint := 0;
  v_withdrawn bigint := 0;
begin
  select * into v_affiliate
  from public.affiliates
  where user_id = p_user_id
  limit 1;

  if not found then
    return jsonb_build_object('affiliate', null);
  end if;

  select coalesce(sum(amount),0)
  into v_pending
  from public.commissions
  where affiliate_code = v_affiliate.code
    and status = 'pending';

  -- Bisa dicairkan: lewat 3 hari, dikurangi yang sudah dialokasikan.
  select coalesce(sum(
    greatest(0, c.amount - coalesce((
      select sum(a.amount)
      from public.affiliate_withdrawal_allocations a
      join public.affiliate_withdrawals w on w.id = a.withdrawal_id
      where a.commission_id = c.id
        and w.status in ('pending','approved','paid')
    ),0))
  ),0)
  into v_available
  from public.commissions c
  where c.affiliate_code = v_affiliate.code
    and c.status = 'available'
    and coalesce(c.available_at, c.created_at) <= now() - interval '3 days';

  -- Sudah jadi komisi, tapi belum lewat masa 3 hari.
  select coalesce(sum(
    greatest(0, c.amount - coalesce((
      select sum(a.amount)
      from public.affiliate_withdrawal_allocations a
      join public.affiliate_withdrawals w on w.id = a.withdrawal_id
      where a.commission_id = c.id
        and w.status in ('pending','approved','paid')
    ),0))
  ),0)
  into v_maturing
  from public.commissions c
  where c.affiliate_code = v_affiliate.code
    and c.status = 'available'
    and coalesce(c.available_at, c.created_at) > now() - interval '3 days';

  select coalesce(sum(a.amount),0)
  into v_reserved
  from public.affiliate_withdrawal_allocations a
  join public.affiliate_withdrawals w on w.id = a.withdrawal_id
  where w.affiliate_code = v_affiliate.code
    and w.status in ('pending','approved');

  select coalesce(sum(amount),0)
  into v_withdrawn
  from public.affiliate_withdrawals
  where affiliate_code = v_affiliate.code
    and status = 'paid';

  return jsonb_build_object(
    'affiliate', jsonb_build_object(
      'code', v_affiliate.code,
      'displayName', v_affiliate.display_name,
      'commissionRate', v_affiliate.commission_rate,
      'status', v_affiliate.status,
      'pending', v_pending,
      'maturing', v_maturing,
      'available', v_available,
      'reserved', v_reserved,
      'withdrawn', v_withdrawn
    )
  );
end;
$$;

-- Izin eksekusi tetap: service_role saja, sama seperti 024.
revoke all on function public.nambah_affiliate_request_withdrawal(uuid,bigint,text,text,text)
  from public, anon, authenticated;
revoke all on function public.nambah_affiliate_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.nambah_affiliate_request_withdrawal(uuid,bigint,text,text,text)
  to service_role;
grant execute on function public.nambah_affiliate_summary(uuid)
  to service_role;

comment on function public.nambah_affiliate_request_withdrawal(uuid,bigint,text,text,text) is
  'Permintaan pencairan komisi afiliasi. Saldo bisa-cair = komisi available '
  'yang sudah lewat 3 hari sejak sukses (coalesce(available_at, created_at)), '
  'dikurangi alokasi pencairan yang sedang berjalan.';
comment on function public.nambah_affiliate_summary(uuid) is
  'Ringkasan saldo afiliasi: pending (order belum sukses), maturing (komisi '
  'sudah jadi, dalam masa tunggu 3 hari), available (bisa dicairkan), '
  'reserved (sedang diproses), withdrawn (sudah dibayar).';
