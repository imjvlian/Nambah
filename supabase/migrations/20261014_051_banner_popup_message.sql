-- ============================================================================
-- 051 - Pesan popup dan dimensi asli gambar banner.
--
-- MASALAH
--
-- Popup memotong gambar. Bukan karena gambarnya salah, tapi karena popup
-- tidak tahu ukuran aslinya: gambar dipasang lewat `background-image`,
-- sehingga browser hanya melihat kotak yang dipaksat CSS.
--
--   - Mode teks: `height: 220px` + `background-size: cover`
--   - Mode bersih: `aspect-ratio: 4/5` + `cover`
--
-- Banner di sistem ini 1200x400 (3:1). Dimasukkan ke kotak 4:5 dengan
-- `cover`, browser harus memperbesar gambar sampai 1650px untuk memenuhi
-- tinggi - lalu memotong sekitar 73% lebar. Teks di dalam desain ikut hilang.
--
-- Dimensi asli harus DISIMPAN, bukan ditebak di client. Diambil dari
-- respons upload Cloudinary, yang selalu memuat `width` dan `height` - jadi
-- angkanya berasal dari server, bukan dari form yang bisa dimanipulasi.
--
-- PESAN POPUP
--
-- Kolom baru untuk pesan yang diketik operator manual. Dipisah dari
-- `subtitle` yang sudah ada karena `subtitle` dipakai carousel dan pop-up
-- tidak punya tombol lagi - memakai ulang `subtitle` berarti mengubah isi
-- carousel setiap kali pesan pop-up diedit.
--
-- TIDAK ADA KOLOM URL BARU
--
-- URL pesan memakai `cta_href` yang sudah ada, dan teks link-nya memakai
-- `cta_label`. Keduanya jadi tidak terpakai di pop-up setelah tombolnya
-- dihapus, sementara carousel tetap memakainya sebagai tombol. Satu field,
-- dua tampilan - bukan dua field yang bisa berisi dua target berbeda untuk
-- satu banner yang sama.
-- ============================================================================

alter table public.promo_banners
  add column if not exists popup_message text,
  add column if not exists image_width integer,
  add column if not exists image_height integer;

comment on column public.promo_banners.popup_message is
  'Pesan yang diketik manual, tampil di bawah gambar pop-up. Baris baru '
  'yang diketik operator dipertahankan - dikosongkan berarti pop-up hanya '
  'menampilkan gambar dan link.';

comment on column public.promo_banners.image_width is
  'Lebar asli gambar dalam piksel, dari respons upload Cloudinary. '
  'Disimpan supaya pop-up bisa menampilkan gambar utuh: tanpa rasio asli '
  'browser hanya bisa menebak dan memotong. Null untuk banner yang diunggah '
  'sebelum migration ini - pop-up membacanya dari gambar saat tampil.';

comment on column public.promo_banners.image_height is
  'Tinggi asli gambar dalam piksel, dari respons upload Cloudinary. '
  'Digunakan bersama image_width untuk menghitung aspect-ratio.';

comment on column public.promo_banners.cta_href is
  'Tautan tujuan. Untuk carousel dipakai sebagai tombol; untuk pop-up dipakai '
  'sebagai link di dalam pesan.';

comment on column public.promo_banners.cta_label is
  'Teks tombol carousel, sekaligus teks link di pesan pop-up.';