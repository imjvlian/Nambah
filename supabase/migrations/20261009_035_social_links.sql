-- 035: Link channel pada permintaan affiliate.
--
-- Melanjutkan `20261009_034_program_affiliate.sql` yang SUDAH dijalankan —
-- file itu tidak diubah, hanya ditambah referensi di sini. Menulis ulang file
-- yang sudah dieksekusi membuat migrasi yang sama tercatat dengan isi berbeda,
-- dan pembacanya nanti akan salah paham.
--
-- Yang ditambahkan: empat kolom link channel di `affiliate_requests`.
--
-- Bentuknya TEXT bebas, bukan URL tervalidasi, dengan sengaja:
--
--   - Tidak ada daftar platform yang dibatasi. Field keempat (link lain) bisa
--     diisi apa pun yang memang dipakai applicant.
--   - Kalau nanti data menunjukkan banyak yang salah bentuk — `www.` di
--    -awalnya, URL yang bukan link channel sama sekali — itu bisa dirapikan
--     dengan satu UPDATE. Lebih murah daripada memaksa semua orang mengisi
--     form yang sama sejak awal.
--
-- Validasi "minimal satu link terisi" dilakukan di sisi aplikasi
-- (`POST /api/account/affiliate-request`), bukan lewat constraint database.
-- Alasannya: pemohon tanpa Instagram tapi punya channel Telegram tetap sah, dan
-- memaksa Instagram akan menyaring orang yang justru aktif jualan.
--
-- Kolom dibuat dengan default '' supaya baris lama — kalau ada — tetap punya
-- nilai yang valid, dan supaya `not null` tidak menggagalkan insert dari kode
-- yang lebih lama.

alter table public.affiliate_requests
  add column if not exists instagram text not null default '',
  add column if not exists tiktok text not null default '',
  add column if not exists youtube text not null default '',
  add column if not exists other_url text not null default '';

-- Verifikasi setelah dijalankan:
--
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'affiliate_requests'
--     and column_name in ('instagram', 'tiktok', 'youtube', 'other_url')
--   order by column_name;
--   -- harus 4 baris, semua `text` dengan default ''
--
-- Kalau hanya sebagian yang muncul, migration belum selesai — jalankan ulang,
-- `if not exists` membuatnya aman.
--
-- Catatan: request yang sudah masuk SEBELUM migrasi ini akan punya link kosong
-- di keempat kolom. Form pendaftaran mewajibkan minimal satu link, tapi baris
-- lama tidak diretrofit — tidak ada gunanya karena yang sudah masuk akan
-- ditinjau manual di panel admin.
