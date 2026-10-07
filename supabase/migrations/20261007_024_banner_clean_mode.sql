-- 024: Banner bersih (tanpa teks overlay).
--
-- show_text_overlay = false → gambar banner dirender full-bleed tanpa
-- judul/subjudul/CTA di atasnya; seluruh area gambar tetap bisa diklik
-- mengikuti cta_href / promo_code. Default true supaya banner lama tidak
-- berubah tampilannya.

alter table public.promo_banners
  add column if not exists show_text_overlay boolean not null default true;

comment on column public.promo_banners.show_text_overlay is
  'true = judul/subjudul/CTA dirender di atas gambar; false = gambar bersih full-bleed (klik seluruh gambar)';
