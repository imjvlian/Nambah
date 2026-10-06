-- Nambah 1.0.12 — promo auto-inactive saat kuota habis + popup banner.
--
-- 1) nambah_promotion_commit kini menonaktifkan promo begitu pemakaian
--    (reserved+redeemed) mencapai quota. Flip hanya terjadi saat commit
--    (redemption final), sehingga order batal tidak menutup promo prematur.
--    Reaktivasi tetap manual oleh admin.
-- 2) promo_banners.display_mode: carousel | popup | both.

create or replace function public.nambah_promotion_commit(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_quota integer;
  v_total bigint;
begin
  update public.promotion_redemptions
  set status = 'redeemed',
      redeemed_at = coalesce(redeemed_at, now()),
      released_at = null,
      updated_at = now()
  where order_id = p_order_id
    and status = 'reserved'
  returning promotion_code into v_code;

  if v_code is not null then
    select quota into v_quota from public.promotions where code = v_code;

    if v_quota is not null then
      select count(*) into v_total
      from public.promotion_redemptions
      where promotion_code = v_code
        and status in ('reserved','redeemed');

      if v_total >= v_quota then
        update public.promotions
        set active = false,
            updated_at = now()
        where code = v_code
          and active = true;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Sweep satu kali untuk promo lama yang kuotanya sudah habis tapi masih aktif.
update public.promotions p
set active = false,
    updated_at = now()
where p.active = true
  and p.quota is not null
  and (
    select count(*)
    from public.promotion_redemptions r
    where r.promotion_code = p.code
      and r.status in ('reserved','redeemed')
  ) >= p.quota;

-- Popup banner: admin memilih banner tampil di carousel, popup, atau keduanya.
alter table public.promo_banners
  add column if not exists display_mode text not null default 'carousel';

alter table public.promo_banners
  drop constraint if exists promo_banners_display_mode_check;

alter table public.promo_banners
  add constraint promo_banners_display_mode_check
  check (display_mode in ('carousel','popup','both'));
