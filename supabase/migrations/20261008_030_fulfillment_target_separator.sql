-- 030: Pemisah server pada `fulfillment_target_template`.
--
-- Sumber data: kolom `description` di `supplier_catalog_items`, yang isinya
-- persis kolom "Deskripsi Produk" di Digiflazz Buyer Member Panel. Untuk dua
-- game ditambahkan contoh dari Deskripsi Seller di panel yang sama.
--
-- Dua masalah yang dipbaiki file ini.
--
-- 1) Genshin Impact dan Wuthering Waves tidak bisa di-fulfill sama sekali.
--
--    `games.requires_server` keduanya `true`, jadi form menanyakan server. Tapi
--    template-nya `{user_id}` — tanpa `{server_id}`. `renderFulfillmentTarget`
--    punya guard:
--
--      if (requiresServer && !placeholders.includes("server_id")) throw ...
--
--    jadi setiap order kedua game itu gagal saat fulfillment dengan pesan
--    "Produk membutuhkan server tetapi template tidak memiliki {server_id}".
--    Bukan order yang terkirim dengan target salah — order yang gagal.
--
-- 2) Enam game lain memakai pemisah yang salah.
--
--    Kolom description mereka berbunyi `Format no tujuan [UID]|[Server]`.
--    Tanda `|` di sana bukan "`|` opsional" melainkan PEMBATAS field, dan
--    Deskripsi Seller Dragon Nest M membuktikannya secara eksplisit:
--
--      "Note : User ID|Server  Contoh : 400628|030003"
--
--    Sebelumnya template-nya `{user_id}{server_id}` yang dirangkai jadi
--    `400628030003` — nol di depan hilang dan pemisah hilang. Sekarang
--    `400628|030003`.
--
-- Yang TIDAK diubah di sini:
--
-- - Mobile Legends dan Mobile Legends Adventure tetap `{user_id}{server_id}`
--   tanpa pemisah. Description mereka eksplisit: "no tujuan = gabungan antara
--   user_id dan zone_id". "Gabungan" berarti disambung, bukan dipisah.
-- - magic-chess juga tetap tanpa pemisah karena Zone ID-nya konsep yang sama
--   dengan Mobile Legends. Description-nya hanya "Masukkan ID dan Server Anda"
--   dan tidak ada contoh supplier — ini asumsi, belum terbukti.
--
-- CATATAN untuk `ragnarok-m-eternal-love`: pemisah `|` di blok 3 adalah ASUMSI.
-- Deskripsi Digiflazz-nya hanya "Masukkan ID dan Server" tanpa contoh, dan tidak
-- ada reseller yang mempublikasikan formatnya (unlike Heroes Evolved dan NBA
-- Infinite yang punya tabel di kuotapulsa.com). Kalau order pertama ditolak
-- supplier, periksa pemisah ini duluan.

-- 1) Dua perbaikan order yang sama sekali tidak bisa jalan.
--    Genshin Impact & Wuthering Waves butuh placeholder `{server_id}`.
update public.games
set fulfillment_target_template = '{user_id}|{server_id}', updated_at = now()
where id in (
  'genshin-impact',
  'wuthering-waves'
);

-- 2) Pemisah `|` untuk keluarga "Format no tujuan [UID]|[Server]".
--
--    Untuk Genshin / HSR / ZZZ, `|` bukan lagi asumsi. Deskripsi Seller di panel
--    Digiflazz (produk ZZZ) menulis:
--      "Format order : UID|Server uid,server uid|server uid(server)"
--    Seller menyebut `|` eksplisit di antara dua separator lain, jadi tanda itu
--    karakter literal — bukan notasi seperti di kolom `description`.
update public.games
set fulfillment_target_template = '{user_id}|{server_id}', updated_at = now()
where id in (
  'zenless-zone-zero',
  'honkai-star-rail',
  'dragon-nest-m-classic'
);

-- 3) Ragnarok M. Pemisah `|` di sini ASUMSI — tidak ada sumber yang menyebut
--    formatnya, dan deskripsi Digiflazz ("Masukkan ID dan Server") tidak
--    memberi contoh.
update public.games
set fulfillment_target_template = '{user_id}|{server_id}', updated_at = now()
where id = 'ragnarok-m-eternal-love';

-- 4) Heroes Evolved & NBA Infinite: pemisah KOMA.
--
--    Tabel format order reseller Digiflazz (kuotapulsa.com) untuk keduanya:
--      Heroes Evolved : "Format tujuan : User ID,Server  Contoh : 12345,100"
--      NBA Infinite   : "Format tujuan : User ID,Server  Contoh : 12345,1001"
--
--    Perhatikan deskripsi Digiflazz untuk keduanya menulis "Format no tujuan
--    [UID]|[Server]" (Heroes Evolved) atau "Masukkan ID dan Server" (NBA
--    Infinite) — tanda `|` di `[UID]|[Server]` itu NOTASI, bukan karakter
--    harfiah. Dragon Nest M satu-satunya game dengan bukti literal `|`, dari
--    Deskripsi Seller di panel: "Note : User ID|Server  Contoh : 400628|030003".
update public.games
set fulfillment_target_template = '{user_id},{server_id}', updated_at = now()
where id in (
  'heroes-evolved',
  'nba-infinite'
);

-- Verifikasi manual setelah dijalankan:
--
--   select id, requires_server, fulfillment_target_template
--   from public.games
--   where requires_server
--   order by id;
--
-- Harusnya 11 baris, dan tidak boleh ada baris dengan `requires_server = true`
-- tapi template `{user_id}` — kombinasi itu yang membuat order gagal total.