-- ============================================================================
-- 058 - P1: consent Syarat & Ketentuan + min payout pencairan configurable
--
-- 1. orders.terms_accepted_at (P1.3, UU PDP)
--
-- Bukti persetujuan Syarat & Ketentuan + Kebijakan Privasi PER TRANSAKSI.
-- Checkout menolak order tanpa consent (400) sebelum efek samping apa pun;
-- kolom ini mencatat waktunya - bukti yang bisa diaudit, bukan sekadar
-- asumsi "pasti sudah setuju".
--
-- 2. affiliate_min_payout di app_settings (P1.4)
--
-- Minimal pencairan komisi. Dulu tidak ada batas sama sekali (RPC 047
-- hanya menolak <= 0) - komisi Rp 500 bisa diajukan cair, dan ongkos
-- proses manualnya lebih mahal dari nominalnya. Sekarang:
--   - nilai default 10.000 terpasang di app_settings;
--   - bisa diubah kapan pun lewat update baris itu (tanpa deploy);
--   - RPC membaca nilai saat itu - sumber kebenaran tunggal.
-- ============================================================================

alter table public.orders
  add column if not exists terms_accepted_at timestamptz;

insert into public.app_settings (key, value)
values ('affiliate_min_payout', '10000')
on conflict (key) do nothing;

-- ============================================================================
-- nambah_affiliate_request_withdrawal + cek minimal pencairan.
--
-- Salinan penuh dari 047 (definisi berjalan saat ini) dengan SATU
-- tambahan: p_amount < affiliate_min_payout -> ditolak dengan pesan
-- berisi nominalnya. Sisanya (masa tunggu 3 hari, alokasi FIFO, guard
-- data rekening) tidak tersentuh.
-- ============================================================================

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
  v_min_payout bigint;
begin
  if p_amount <= 0 then
    raise exception 'Nominal withdrawal harus lebih dari 0.';
  end if;

  if length(trim(coalesce(p_method,''))) < 2
     or length(trim(coalesce(p_account_name,''))) < 2
     or length(trim(coalesce(p_account_number,''))) < 4 then
    raise exception 'Data rekening withdrawal belum lengkap.';
  end if;

  /*
   * Minimal pencairan (P1.4): dibaca dari app_settings saat request,
   * jadi mengubahnya tidak butuh deploy. coalesce 10000 = nilai default
   * kalau barisnya terhapus.
   */
  select coalesce((s.value #>> '{}')::bigint, 10000)
  into v_min_payout
  from public.app_settings s
  where s.key = 'affiliate_min_payout';

  if p_amount < v_min_payout then
    raise exception 'Minimal pencairan komisi adalah Rp %.', v_min_payout;
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

revoke all on function public.nambah_affiliate_request_withdrawal(uuid,bigint,text,text,text)
  from public;
grant execute on function public.nambah_affiliate_request_withdrawal(uuid,bigint,text,text,text)
  to authenticated, anon;
