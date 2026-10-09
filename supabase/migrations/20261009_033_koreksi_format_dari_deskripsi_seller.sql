-- 033: Koreksi format order dari Deskripsi Seller Digiflazz.
--
-- Migration 031 dan 032 memakai sumber yang keliru untuk tiga game di file
-- ini. Sumber yang keliru itu party ketiga: Codashop, MooGold, KZStore,
-- itemku, dan tabel format reseller. Yang benar adalah Deskripsi Seller di
-- panel Digiflazz — kolom yang ditulis orang yang benar-benar menerima order.
--
-- Diperbarui: 2026-10-09
--
-- 1) TOM AND JERRY: CHASE — TIDAK butuh server.
--
--    Deskripsi Seller, dua seller independen:
--      pre34663343 (TTAJ60): "Tujuan = User ID"
--      pre34663344 (TJ180):  "Tujuan = User ID (Server Tidak Perlu)"
--
--    Kolom Deskripsi Produknya literally "-", jadi tidak ada sinyal dari sana.
--    Schema sebelumnya meminta server berupa NAMA ("Asia") dengan pemisah
--    koma, bersandar pada Codashop SG ("Player ID and Server ID"), NetEase
--    (pay.neteasegames.com/tjc), dan itemku ("11777888, Asia, iTeMkU").
--    Ketiganya pihak ketiga, dan bertentangan dengan seller sebenarnya.
--
--    Meminta server untuk game yang hanya butuh ID berarti order ditolak
--    SETELAH pelanggan membayar.
--
-- 2) ONE PUNCH MAN: THE STRONGEST — TIDAK butuh server.
--
--    Deskripsi Seller (pre34663356, seller OPM1):
--      "Tujuan = ID saja salah otomatis gagal"
--
--    Perhatikan: Deskripsi PRODUK untuk SKU yang sama menulis
--    `Format no tujuan [UID]|[Server]` — string yang PERSIS sama dengan yang
--    dipakai LifeAfter, Honkai Star Rail, dan Wuthering Waves, yang semuanya
--    memang butuh server. Nama produknya `ONEPUNCH_13`, dan angka itu nominal
--    kupon, bukan server.
--
--    Ini bukti bahwa kolom Deskripsi Produk bisa jadi boilerplate. Karena itu
--    Deskripsi Seller — kalau ada — yang menang atas kolom Deskripsi Produk.
--    Aturan itu sekarang tertulis di `GameFulfillmentTarget` di
--    `src/lib/game-targets.ts`.
--
-- 3) HEROES EVOLVED — pemisah KOMA -> PIPE.
--
--    Kolom Deskripsi Produk: `Format no tujuan [UID]|[Server]`.
--
--    Sebelumnya pemisah koma, dari tabel reseller Digiflazz pihak ketiga
--    (kuotapulsa.com): "Format tujuan : User ID,Server  Contoh : 12345,100".
--
--    Alasan pipe lebih benar:
--
--    - Di data kita ada dua gaya Deskripsi Produk yang berbeda artinya.
--      "no tujuan = gabungan antara user_id dan zone_id" (Mobile Legends) dan
--      "no tujuan = gabungan user id dan zone id" (Mobile Legends Adventure)
--      memakai kata GABUNG, dan keduanya memang disambung tanpa pemisah.
--      Yang memakai notasi kurung siku `[UID]|[Server]` bermaksud DIPISAH.
--      Kalau maksudnya disambung, seller akan menulis "gabung" seperti dua
--      game itu lakukan.
--
--    - Bukti literal: LifeAfter, seller menulis di panel
--      "FORMAT : USER ID|SERVER contoh 123456|500001". Pipe-nya nyata, bukan
--      notasi. Heroes Evolved memakai string Deskripsi Produk yang sama.
--
--    - Prioritas sumber. Kolom Deskripsi Produk milik Digiflazz lebih
--      otoritatif daripada tabel reseller pihak ketiga, apalagi setelah
--      terbukti tidak selalu akurat (lihat One Punch Man di atas).
--
--    CATATAN: Deskripsi Seller untuk Heroes Evolved (PT*** dan Om***) tidak
--    menyebut format sama sekali — hanya promosi, dan satu kalimat
--    "ID Salah = Otomatis Gagal" yang bicara soal User ID, bukan pemisah.
--    Jadi pipe di sini bersandar pada Deskripsi Produk saja.
--
--    Kalau order pertama ditolak supplier, PEMISAH adalah hal pertama yang
--    diperiksa duluan. Koma adalah alternatif yang mungkin; koreksinya satu
--    baris SQL, tidak ada perubahan kode. Dropdown 11 server di
--    `HEROES_EVOLVED_SERVER_OPTIONS` tidak diubah — kode server (100, 101,
--    111, ...) adalah fakta milik game-nya, bukan konvensi Digiflazz, jadi
--    tidak perlu diubah bersamanya.

-- 1) dan 2) Dua game tanpa server. `requires_server` ikut diturunkan supaya
--    form berhenti menanyakan server.
--
--    `requires_server` yang di-032 dibuat `true` untuk keduanya sekarang
--    dikembalikan ke `false`, karena kalau tetap `true` form akan terus
--    menanyakan server yang tidak dipakai template.
update public.games
set
  requires_server = false,
  fulfillment_target_template = '{user_id}',
  updated_at = now()
where id in (
  'tom-and-jerry-chase',
  'one-punch-man'
);

-- 3) Heroes Evolved: pemisah pipe. `requires_server` tetap true — memang
--    butuh server, dan template sekarang memuat `{server_id}`.
update public.games
set fulfillment_target_template = '{user_id}|{server_id}', updated_at = now()
where id = 'heroes-evolved';

-- ── Verifikasi ──────────────────────────────────────────────────────────
--
-- 1) Tiga game yang diperbaiki harus persis seperti ini:
--
--      tom-and-jerry-chase  srv=false  {user_id}
--      one-punch-man        srv=false  {user_id}
--      heroes-evolved       srv=true   {user_id}|{server_id}
--
--    select id, requires_server, fulfillment_target_template
--    from public.games
--    where id in ('tom-and-jerry-chase', 'one-punch-man', 'heroes-evolved')
--    order by id;
--
-- 2) Tidak boleh ada game yang order-nya gagal total. Dua arah:
--
--    select id, requires_server, fulfillment_target_template
--    from public.games
--    where active
--      and fulfillment_target_template like '%{server_id}%'
--      and requires_server is not true;
--    -- harus kosong
--
--    select id, requires_server, fulfillment_target_template
--    from public.games
--    where active
--      and requires_server is true
--      and (
--        fulfillment_target_template is null
--        or fulfillment_target_template not like '%{server_id}%'
--      );
--    -- harus kosong
--
-- 3) Setelah file ini, jumlah game dengan `requires_server = true` adalah 12:
--    8 punya dropdown server, 4 sengaja numeric free-text karena daftar
--    server-nya dinamis (Mobile Legends, Mobile Legends Adventure,
--    Magic Chess, Dragon Nest M Classic).