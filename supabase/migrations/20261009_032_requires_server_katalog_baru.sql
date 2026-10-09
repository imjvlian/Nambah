-- 032: Nama tampilan LifeAfter + `requires_server` tiga game katalog baru.
--
-- Dua perbaikan berbeda dalam satu file karena keduanya menyangkut baris yang
-- sama, dan keduanya harus berlaku bersamaan.
--
-- 1) `requires_server` tiga game berikut masih `false` di tabel `games`.
--
--    Migration 031 hanya mengisi `fulfillment_target_template`; kolom
--    `requires_server` tidak disentuh dengan asumsi bahwa `catalog-sync`
--    sudah menaruhnya dengan benar. Asumsi itu SALAH — ketiganya masih `false`.
--
--    Akibatnya order-nya GAGAL TOTAL, bukan terkirim dengan target salah:
--    `requires_server = false` berarti form tidak pernah menanyakan server,
--    jadi `serverId` selalu `null`, dan `renderFulfillmentTarget` punya guard:
--
--      if ((requiresServer || placeholders.includes("server_id")) && !serverId)
--        throw ...
--
--    Template-nya memuat `{server_id}`, jadi syarat kedua terpenuhi dan
--    `serverId` yang `null` membuat fungsi melempar error. Setiap order ketiga
--    game itu ditolak SEBELUM dikirim ke supplier.
--
--    Yang dipulihkan di sini persis nilai yang sudah disepakati di
--    `src/lib/game-targets.ts` — bukan tebakan baru.
--
-- 2) Nama tampilan LifeAfter.
--
--    Sengaja TIDAK diubah di database. Alasannya ada di
--    `DISPLAY_NAME_OVERRIDES` (`src/lib/catalog-repository.ts`): `resolveGame`
--    mencocokkan SKU ke game dengan `normalizeText(name) === normalizeText(brand)`,
--    dan brand-nya persis "LifeAfter Credits". Kalau `games.name` diubah jadi
--    "LifeAfter" di sini, sync berikutnya tidak akan menemukan game ini dan akan
--    membuat duplikat dengan 17 produk yang sama.
--
--    Yang diubah hanya apa yang dilihat pelanggan, di sisi aplikasi.

-- 1) Pulihkan `requires_server` untuk tiga game yang template-nya butuh server.
--
--    Nilai `true` di sini berpasangan dengan template yang sudah-installed
--    oleh 031. Yang salah hanya kolom ini.
update public.games
set requires_server = true, updated_at = now()
where id in (
  'lifeafter-credits',
  'one-punch-man',
  'tom-and-jerry-chase'
);

-- Verifikasi 1 — harus mengembalikan 0 baris.
--
-- Setiap baris yang muncul adalah game yang order-nya akan gagal saat
-- fulfillment: template butuh server tapi form tidak pernah menanyakannya.
--
--   select id, requires_server, fulfillment_target_template
--   from public.games
--   where active
--     and fulfillment_target_template like '%{server_id}%'
--     and requires_server is not true;
--
-- Verifikasi 2 — arah sebaliknya. `requires_server = true` tanpa
-- `{server_id}` di template juga gagal, dengan pesan berbeda:
-- "Produk membutuhkan server tetapi template tidak memiliki {server_id}".
--
--   select id, requires_server, fulfillment_target_template
--   from public.games
--   where active
--     and requires_server is true
--     and (
--       fulfillment_target_template is null
--       or fulfillment_target_template not like '%{server_id}%'
--     );
--
-- Dua query di atas harus kosong. Kalau tidak, `gamesMissingCuratedTarget`
-- dan `renderFulfillmentTarget` akan menemukan sinkronisasi yang rusak
-- sebelum pelanggan menemukannya.