-- ============================================================================
-- 052 - Pisahkan input link popup dari link carousel.
--
-- MASALAH
--
-- Satu field dipakai dua arti sekaligus: `cta_label` jadi teks tombol di
-- carousel dan teks link di pop-up; `cta_href` jadi tujuan tombol di
-- carousel dan URL link di pop-up.
--
-- Akibatnya operator harus tahu halaman ini untuk satu banner,
-- dan tidak bisa memberi teks link pop-up yang berbeda dari tombol carousel
-- padahal keduanya untuk audience yang berbeda dan sering beda nada.
--
-- KOLOM BARU, BUKAN MENGUBAH `cta_label` DAN `cta_href`
--
-- Nama carousel tidak berubah sama sekali, jadi tidak ada banner yang
-- tampilannya ikut bergeser. Kolom baru hanya diisi kalau operator
-- mengisinya; kosong berarti pop-up memakai nilai `cta_*` seperti
-- sebelumnya - jadi migrasi ini tidak mengubah apa pun yang sedang tayang.
--
-- `popup_message` dari migration 051 tidak disentuh. Yang dipisah di sini
-- hanya bagian LINK, karena itu satu-satunya bagian yang masih berbagi
-- makna dengan carousel.
-- ============================================================================

alter table public.promo_banners
  add column if not exists popup_link_label text,
  add column if not exists popup_link_href text;

comment on column public.promo_banners.popup_link_label is
  'Teks link di pesan pop-up. Kosong berarti memakai cta_label, sehingga '
  'perilaku banner yang sudah ada tidak berubah.';

comment on column public.promo_banners.popup_link_href is
  'URL link di pesan pop-up, hanya http/https. Kosong berarti memakai '
  'cta_href. Kalau keduanya kosong, pop-up tidak menampilkan link.';