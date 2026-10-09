-- 031: Format order delapan game katalog baru.
--
-- Delapan game ini masuk lewat `catalog-sync` dan lahir dengan
-- `fulfillment_target_template` NULL. `gamesMissingCuratedTarget` menandai
-- mereka sebagai blocker, jadi memang belum pernah dikirim ke supplier.
--
-- Berbeda dengan migrasi 030, nilai di sini BUKAN hasil membaca panel
-- Digiflazz. Kolom `description` di `supplier_catalog_items` hanya memberi
-- sinyal untuk tiga game; sisanya kosong, `-`, atau tidak ada sama sekali.
-- Setiap nilai di bawah diambil dari sumber independen yang bisa diperiksa
-- ulang, dan sumbernya ditulis di `src/lib/game-targets.ts`.
--
-- Yang berubah di file ini HANYA kolom `fulfillment_target_template`.
-- `requires_server` sengaja tidak disentuh: nilainya sudah benar di tabel
-- `games` untuk game yang butuh server, dan `catalog-sync` tidak pernah
-- menimpa kolom itu untuk game yang sudah ada.
--
-- Urutan blok sengaja mengikuti `requires_server`: tiga game pertama butuh
-- `{server_id}`, lima berikutnya tidak. Kalau `requires_server` dan template
-- tidak sinkron, `renderFulfillmentTarget` melempar error — order yang GAGAL,
-- bukan order terkirim dengan ID salah.

-- 1) Butuh server, pemisah `|`.
--
-- LifeAfter Credits: "Format no tujuan [UID]|[Server]". Yang dikirim adalah
-- KODE server enam digit, bukan nama — contoh `123456|500001`. Daftar 90 kode
-- ada di `LIFEAFTER_SERVER_OPTIONS` (`src/lib/game-account.ts`).
--
-- One Punch Man: The Strongest: deskripsi sama-sama `[UID]|[Server]`, kedua
-- kolom angka. KZStore: "Contoh UID: 12345679 dan SID: 123456".
update public.games
set fulfillment_target_template = '{user_id}|{server_id}', updated_at = now()
where id in (
  'lifeafter-credits',
  'one-punch-man'
);

-- 2) Butuh server, pemisah KOMA.
--
-- Tom and Jerry: Chase. Ini satu-satunya game di daftar ini yang server-nya
-- berupa NAMA ("Asia"), bukan kode angka, dan pemisahnya koma.
--
-- CATATAN: deskripsi Digiflazz untuk game ini literally "-", jadi TIDAK ada
-- bukti dari Digiflazz. Yang dipakai tiga sumber independen:
--   itemku       "Chase, for example: 11777888, Asia, iTeMkU"
--   Codashop SG  "Tom and Jerry: Chase Player ID and Server ID"
--   NetEase      pay.neteasegames.com/tjc punya kolom Server
-- Kalau order pertama ditolak supplier, periksa pemisah ini duluan.
update public.games
set fulfillment_target_template = '{user_id},{server_id}', updated_at = now()
where id = 'tom-and-jerry-chase';

-- 3) ID saja, tanpa kolom server.
--
-- Laplace M, Lords Mobile, AU2 Mobile: ID numerik. Gravitas/Synapse untuk
-- Lords Mobile menyebut "Contoh: 4295037856" (IGG ID). TokoVCR/KuponTop untuk
-- AU2 hanya satu langkah, "Masukkan User ID".
--
-- Speed Drifters: deskripsi Digiflazz-nya "-", dan tidak ada SATU pun sumber
-- yang menyebut server — KALEOZ "UID ONLY", MooGold "Only Player ID Required",
-- UniPin, Uquid, Kaisar. Untuk game Garena, `-` berarti memang tidak ada field
-- tambahan, bukan data yang hilang.
--
-- Werewolf (Party Game): hanya User ID. Uquid: "Tap your Profile to get your
-- User ID and User Name".
update public.games
set fulfillment_target_template = '{user_id}', updated_at = now()
where id in (
  'laplace-m',
  'lords-mobile',
  'au2-mobile',
  'speed-drifters',
  'werewolf-party-game'
);

-- Verifikasi manual setelah dijalankan:
--
--   select id, requires_server, fulfillment_target_template
--   from public.games
--   where id in (
--     'laplace-m', 'lifeafter-credits', 'lords-mobile', 'one-punch-man',
--     'speed-drifters', 'tom-and-jerry-chase', 'werewolf-party-game',
--     'au2-mobile'
--   )
--   order by id;
--
-- Harusnya 8 baris. Tiga baris pertama (`lifeafter-credits`,
-- `one-punch-man`, `tom-and-jerry-chase`) WAJIB punya `requires_server = true`
-- dan template yang memuat `{server_id}`. Kalau `requires_server` ternyata
-- false untuk salah satu dari tiga itu, form tidak menanyakan server —
-- `renderFulfillmentTarget` akan melempar "Server / Zone wajib tersedia".
--
-- Lima baris sisanya harus punya `requires_server = false` dan template
-- persis `{user_id}`. Kalau salah satu `requires_server = true`, form minta
-- server tapi template tidak memakainya — error "Produk membutuhkan server
-- tetapi template tidak memiliki {server_id}".
--
-- Cek juga keutuhan 030 yang sudah berjalan:
--
--   select count(*) from public.games
--   where requires_server
--     and (fulfillment_target_template is null
--          or fulfillment_target_template not like '%{server_id}%');
--
-- Harus 0. Angka itu jumlah game yang order-nya akan gagal total saat
-- fulfillment.