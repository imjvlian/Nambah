-- 029: Target fulfillment per game.
--
-- Latar belakang. Dua kolom di `games` sudah lama ada tapi tidak pernah terisi
-- untuk game-game baru:
--
--   fulfillment_target_template  -> cara merangkai isian form menjadi
--                                   `customer_no` yang dikirim ke Digiflazz
--   requires_server              -> apakah form perlu kolom server
--
-- `catalog-sync` membuat game baru hanya dari nama brand SKU
-- (`product-identity.ts: inferRequiresServer` dulu hanya mengenali dua nama),
-- sehingga game yang baru ditemukan sinkron selalu lahir dengan template
-- kosong. Form-nya tetap bisa diisi pelanggan, tapi fulfillment tidak punya
-- cara menyusun targetnya.
--
-- Data di bawah diambil dari kolom "Deskripsi Produk" di Digiflazz Buyer
-- Member Panel, bukan dari tebakan. Rujukan per game ada di
-- `src/lib/game-targets.ts`, yang juga dipakai saat sync membuat game baru —
-- supaya masalah ini tidak muncul lagi di game berikutnya.
--
-- Idempoten: hanya menulis ulang nilai yang sama. Tidak ada INSERT/DELETE.

-- 1) Game yang butuh kolom server tambahan.
--
-- Digiflazz menulis "[UID][|Server]" untuk Dragon Nest, Honkai Star Rail,
-- dan Heroes Evolved; "Masukkan ID dan Server" untuk NBA Infinite;
-- "user_id|Server" untuk Ragnarok M: Eternal Love.
update public.games
set requires_server = true, updated_at = now()
where id in (
  'dragon-nest-m-classic',
  'nba-infinite',
  'zenless-zone-zero',
  'honkai-star-rail',
  'heroes-evolved',
  'ragnarok-m-eternal-love'
);

-- 2) Target dirangkai dari ID + server.
--
-- Perhatikan `mobile-legends-adventure` termasuk di sini meski form-nya sudah
-- benar sejak dulu: ia punya cabang schema mobile-legends yang menanyakan User
-- ID + Zone ID, tapi templatenya kosong. Akibatnya order lolos validasi lalu
-- gagal saat supplier menerima target yang tidak lengkap.
update public.games
set fulfillment_target_template = '{user_id}{server_id}', updated_at = now()
where id in (
  'dragon-nest-m-classic',
  'nba-infinite',
  'zenless-zone-zero',
  'mobile-legends-adventure',
  'honkai-star-rail',
  'heroes-evolved',
  'ragnarok-m-eternal-love'
);

-- 3) Target hanya dari ID.
update public.games
set fulfillment_target_template = '{user_id}', updated_at = now()
where id in (
  'call-of-duty-mobile',
  'state-of-survival',
  'where-winds-meet',
  'vidio',
  'xbox',
  'league-of-legends-pc',
  'teamfight-tactics-mobile'
);

-- CATATAN — kenapa State of Survival dan NBA Infinite tidak diberi
-- `{user_id}{server_id}` di blok 2 meski deskripsi Digiflazz-nya
-- "Masukkan User ID." dan "Masukkan ID dan Server":
--
-- `state-of-survival` hanya butuh User ID, jadi `{user_id}` di blok 3 sudah
-- benar; `requires_server` sengaja tidak disentuh karena deskripsinya memang
-- tidak menyebut server.
--
-- `nba-infinite` diberi `{user_id}{server_id}` di blok 1 dan 2. Tapi route
-- Volsever-nya (`nba-infinite`) berstatus `fail` di health check, jadi
-- auto-check nickname-nya dinonaktifkan di `volsever/games.ts` sampai
-- Volsever mengonfirmasi ulang. Jangan dinyalakan hanya karena slug-nya ada.