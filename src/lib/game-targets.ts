/**
 * Peta kurasi target fulfillment per game.
 *
 * Ini satu-satunya tempat yang perlu diisi saat menambah game baru ke katalog.
 * `catalog-sync`-sequences membacanya saat membuat baris `games` baru, supaya
 * game yang ditemukan dari SKU supplier tidak lagi lahir dengan
 * `requires_server = false` dan `fulfillment_target_template` kosong.
 *
 * Kenapa perlu ada, dan bukan tetap diperbaiki manual:
 *
 * - `product-identity.ts` sebelumnya menebak `requires_server` dari dua nama
 *   brand saja ("mobile legends", "genshin impact"). Honkai Star Rail,
 *   Heroes Evolved, dan Ragnarok M semua lahir dengan `requires_server` false.
 * - `catalog-sync` tidak pernah menyentuh kolom template untuk game yang sudah
 *   ada, jadi perbaikan manual bertahan — tapi hanya sampai game berikutnya
 *   ditemukan sinkron.
 *
 * Sumber tiap nilai: kolom `description` di tabel `supplier_catalog_items`,
 * yang isinya persis "Deskripsi Produk" dari Digiflazz Buyer Member Panel,
 * ditambah contoh pada Deskripsi Seller kalau ada. Description adalah acuan
 * karena itulah yang isi `customer_no` harus iru; nama game tidak.
 */

export type GameFulfillmentTarget = {
  /** Apakah form perlu kolom server. */
  requiresServer: boolean;
  /**
   * Cara merangkai isian menjadi `customer_no`:
   *   `{user_id}`                -> hanya ID
   *   `{user_id}{server_id}`     -> ID dan server digabung tanpa pemisah
   *   `{user_id}|{server_id}`    -> ID dan server dipisah karakter `|`
   *
   * Pemisah mana yang benar TIDAK bisa ditebak dari nama game; semuanya
   * diambil dari kolom `description` di `supplier_catalog_items` dan, kalau ada,
   * contoh pada Deskripsi Seller di panel Digiflazz. Ringkasnya:
   *
   *   "no tujuan = gabungan user id dan zone id"  -> tanpa pemisah (Mobile
   *       Legends, Mobile Legends Adventure)
   *
   *   "Format no tujuan [UID]|[Server]"            -> pemisah `|`
   *
   *       Dua-duanya tidak sama. Yang menyebut kata "GABUNG" memang bermaksud
   *       disambung tanpa pemisah. Yang memakai notasi kurung siku dengan tanda
   *       pisah di dalamnya bermaksud dipisah — kalau maksudnya disambung,
   *       seller akan menulis "gabung" seperti dua game di atas.
   *
   *       Bukti literal: LifeAfter, seller menulis "FORMAT : USER ID|SERVER
   *       contoh 123456|500001" di panel. Pipe-nya nyata, bukan notasi.
   *
   *   "Masukkan ID dan Server"                     -> pemisah KOMA (NBA
   *       Infinite), dari tabel format reseller: `Contoh : 12345,1001`.
   *       RAGUNAROK M punya Deskripsi Produk yang persis sama tapi memakai
   *       pipe. Keduanya prose, jadi tidak ada pola yang bisa membedakan.
   *
   * PENTING: kolom Deskripsi Produk bisa jadi boilerplate. One Punch Man punya
   *   string `Format no tujuan [UID]|[Server]` yang sama persis dengan LifeAfter,
   *   tapi Deskripsi Seller-nya menyatakan "Tujuan = ID saja". Karena itu
   *   Deskripsi Seller — kalau ada — yang menang atas kolom Deskripsi Produk.
   *
   * null berarti game ini belum diverifikasi dan belum boleh dikirim ke
   * supplier. Sengaja dibiarkan kosong supaya readiness menandainya blocker,
   * daripada menebak dan risiko mengirim ID salah.
   */
  template: string | null;
};

export const CURATED_GAME_TARGETS: Readonly<Record<string, GameFulfillmentTarget>> = {
  // ── ID + server, pemisah `|` ────────────────────────────────────────────
  // Format no tujuan [UID]|[Server]. Contoh supplier Dragon Nest M:
  // "Note : User ID|Server  Contoh : 400628|030003".
  //
  // Honkai Star Rail punya konfirmasi terkuat kedua setelah Dragon Nest M: seller
  // menerima empat format, dan salah satunya `User ID|Server` dengan contoh
  // `12345|os_asia`.
  //
  // Genshin Impact dan Wuthering Waves sebelumnya `{user_id}` padahal
  // `requires_server` true. Itu bukan sekadar membuang pilihan pelanggan —
  // `renderFulfillmentTarget` melempar error "Produk membutuhkan server tetapi
  // template tidak memiliki {server_id}", jadi SETIAP order kedua game itu
  // gagal saat fulfillment.
  //
  // Genshin, HSR, dan ZZZ memakai `os_*` karena Deskripsi Seller di panel
  // Digiflazz menuliskannya eksplisit:
  //   "Format order : UID|Server ... List Server : Asia,os_asia,...;
  //    America,os_usa,002; Europe,os_euro,003; TW, HK, MO,os_cht,004"
  //
  // Wuthering Waves masih nama region ("America, Asia, Europe, SEA, HMT") karena
  // publisher-nya Kuro Games, bukan HoYoverse, dan Deskripsi Seller-nya belum
  // pernah dilihat.
  "genshin-impact": { requiresServer: true, template: "{user_id}|{server_id}" },
  "wuthering-waves": { requiresServer: true, template: "{user_id}|{server_id}" },
  "zenless-zone-zero": { requiresServer: true, template: "{user_id}|{server_id}" },
  "honkai-star-rail": { requiresServer: true, template: "{user_id}|{server_id}" },
  "dragon-nest-m-classic": { requiresServer: true, template: "{user_id}|{server_id}" },
  // Heroes Evolved. Deskripsi Produknya `Format no tujuan [UID]|[Server]` —
  // string yang sama persis dengan LifeAfter, HSR, dan WuWa, dan pipe-nya di
  // kelompok game itu terbukti literal.
  //
  // Sebelumnya template ini KOMA, bersandar pada tabel reseller pihak ketiga
  // (kuotapulsa.com: "Contoh : 12345,100"). Sumber itu bukan acuan: kolom
  // Deskripsi Produk milik Digiflazz sendiri lebih tinggi otoritivitasnya, dan
  // perbedaan "gabung" (disambung) vs "[UID]|[Server]" (dipisah) memang
  // terlihat di data kita.
  //
  // Deskripsi Seller untuk game ini (PT*** dan Om***) TIDAK menyebut format
  // sama sekali — hanya promosi, dan satu kalimat "ID Salah = Otomatis Gagal"
  // yang bicara soal User ID, bukan pemisah. Jadi pipe di sini bersandar pada
  // Deskripsi Produk saja.
  //
  // Kalau order pertama ditolak supplier, PEMISAH adalah hal pertama yang
  // diperiksa duluan. Koma adalah alternatif yang mungkin; koreksinya satu
  // baris SQL, tidak ada perubahan kode.
  "heroes-evolved": { requiresServer: true, template: "{user_id}|{server_id}" },

  // Ragnarok M: "Masukkan ID dan Server". Pemisah `|` belum terverifikasi —
  // tidak ada reseller maupun panel yang menyebut formatnya, dan deskripsi
  // Digiflazz tidak memberi contoh. Dibiarkan `|` karena itu bentuk yang dipakai
  // seller Dragon Nest M, tapi ini ASUMSI.
  "ragnarok-m-eternal-love": { requiresServer: true, template: "{user_id}|{server_id}" },

  // ── ID + server, pemisah koma ───────────────────────────────────────────
  // NBA Infinite: Deskripsi Produknya "Masukkan ID dan Server" — prose, tanpa
  // notasi kurung siku. Pemisah koma berasal dari tabel format order reseller
  // Digiflazz (kuotapulsa.com): "Format tujuan : User ID,Server  Contoh : 12345,1001".
  // Server berupa kode angka, bukan nama region: 1001 Oceania, 5001
  // SouthAmerica, 6001 NA, 7001 Asia, 8001 Europe.
  //
  // CATATAN: ini masih ASUMSI satu sumber. Ragnarok M punya Deskripsi Produk
  // yang persis sama ("Masukkan ID dan Server") tapi memakai pipe. Keduanya
  // prose, jadi tidak ada pola yang bisa membedakan. Kalau order NBA Infinite
  // ditolak supplier, periksa pemisah ini duluan.
  "nba-infinite": { requiresServer: true, template: "{user_id},{server_id}" },

  // ── Katalog baru (2026-10-09) ───────────────────────────────────────────
  // Delapan game yang masuk katalog setelah peta ini pertama dibuat. Semuanya
  // sebelumnya ada di `games` tanpa `fulfillment_target_template`, jadi
  // `gamesMissingCuratedTarget` menandainya sebagai blocker.
  //
  // Untuk game yang tadinya tidak punya template, bedanya bukan format tapi
  // KETERSEDIAAN: sebelum ini, satu-satunya cara tahu formatnya adalah
  // Deskripsi Seller di panel Digiflazz. Sekarang tiap nilai di bawah punya
  // sumber independen yang bisa diperiksa ulang.
  //
  // "ID saja" berarti tidak ada kolom server sama sekali — form hanya satu,
  // dan `customer_no` = ID apa adanya.
  //
  // Speed Drifters: deskripsi Digiflazz-nya `-`, dan lima sumber reseller
  // (KALEOZ "UID ONLY", MooGold "Only Player ID Required", UniPin, Uquid,
  // Kaisar) tidak satu pun menyebut server. `-` di sini berarti memang tidak
  // ada field tambahan, bukan data yang hilang.
  "laplace-m": { requiresServer: false, template: "{user_id}" },
  "lords-mobile": { requiresServer: false, template: "{user_id}" },
  "speed-drifters": { requiresServer: false, template: "{user_id}" },
  "werewolf-party-game": { requiresServer: false, template: "{user_id}" },
  // AU2 Mobile: sebagian besar reseller hanya minta User ID (SEAGM dan Uquid
  // eksplisit "Only User ID is needed"; TokoVCR dan KuponTop menyebut satu
  // langkah, "Masukkan User ID"). Codashop KHM juga tanpa
  // server. Minority yang minta server (UniPin) tidak kita ikuti.
  "au2-mobile": { requiresServer: false, template: "{user_id}" },

  // LifeAfter Credits: deskripsi Digiflazz "Format no tujuan [UID]|[Server]".
  // Server dikirim sebagai KODE angka enam digit (500001…730001), bukan nama
  // server — contoh order dari panel: `123456|500001`. Daftar lengkap kode dan
  // nama ada di `LIFEAFTER_SERVER_OPTIONS` (`game-account.ts`).
  //
  // NetEase (publisher) mengonfirmasi dua kolom: "Masukkan LifeAfter User ID
  // Anda dan pilih server game" di pay.neteasegames.com/lifeafter/topup.
  "lifeafter-credits": { requiresServer: true, template: "{user_id}|{server_id}" },

  // One Punch Man: The Strongest. TIDAK butuh server.
  //
  // Kolom "Deskripsi Produk" menulis `Format no tujuan [UID]|[Server]`, tapi
  // Deskripsi Seller untuk game ini justru menyatakan sebaliknya, dan itu yang
  // diikut:
  //
  //   pre34663356 (OPM1): "Tujuan = ID saja salah otomatis gagal"
  //
  // Nama produknya `ONEPUNCH_13` — angka itu nominal kupon, bukan server.
  //
  // Ini bukti bahwa kolom Deskripsi Produk bisa jadi boilerplate: game ini
  // punya string yang sama persis dengan LifeAfter dan Wuthering Waves, yang
  // memang butuh server. Sumber pihak ketiga (Codashop, MooGold, KZStore)
  // semuanya menyebut User ID + Server ID, tapi seller yang benar-benar
  // menerima orderIni tidak memintanya. Kalau tetap mengirim `12345679|123456`,
  // order-nya ditolak setelah pembayaran.
  "one-punch-man": { requiresServer: false, template: "{user_id}" },

  // Tom and Jerry: Chase. TIDAK butuh server.
  //
  // Deskripsi Produknya literally "-", jadi tidak ada sinyal sama sekali dari
  // sana. Dua seller independen menyatakan hal yang sama, eksplisit:
  //
  //   pre34663343 (TTAJ60): "Tujuan = User ID"
  //   pre34663344 (TJ180):  "Tujuan = User ID (Server Tidak Perlu)"
  //
  // Sebelumnya template ini `{user_id},{server_id}` dengan server berupa nama
  // ("Asia"), bersandar pada Codashop SG, NetEase, dan itemku. Ketiganya
  // pihak ketiga, dan Bertentangan dengan seller sebenarnya.
  "tom-and-jerry-chase": { requiresServer: false, template: "{user_id}" },

  // ── ID + Zone ID, digabung tanpa pemisah ────────────────────────────────
  // Deskripsinya eksplisit: "no tujuan = gabungan antara user_id dan zone_id".
  // magic-chess ikut di sini karena Zone ID-nya konsep yang sama dengan
  // Mobile Legends — meski deskripsinya hanya "Masukkan ID dan Server Anda",
  // belum ada contoh supplier yang membuktikan pemisah `|`.
  "mobile-legends": { requiresServer: true, template: "{user_id}{server_id}" },
  "mobile-legends-adventure": { requiresServer: true, template: "{user_id}{server_id}" },
  "magic-chess": { requiresServer: true, template: "{user_id}{server_id}" },

  // ── ID saja ────────────────────────────────────────────────────────────
  "free-fire": { requiresServer: false, template: "{user_id}" },
  "free-fire-max": { requiresServer: false, template: "{user_id}" },
  "pubg-mobile": { requiresServer: false, template: "{user_id}" },
  "honor-of-kings": { requiresServer: false, template: "{user_id}" },
  "arena-of-valor": { requiresServer: false, template: "{user_id}" },
  "call-of-duty-mobile": { requiresServer: false, template: "{user_id}" },
  "delta-force": { requiresServer: false, template: "{user_id}" },
  "fc-mobile": { requiresServer: false, template: "{user_id}" },
  "marvel-rivals": { requiresServer: false, template: "{user_id}" },
  "aniimo": { requiresServer: false, template: "{user_id}" },
  "state-of-survival": { requiresServer: false, template: "{user_id}" },
  "where-winds-meet": { requiresServer: false, template: "{user_id}" },
  "valorant": { requiresServer: false, template: "{user_id}" },
  "league-of-legends-pc": { requiresServer: false, template: "{user_id}" },
  "league-of-legends-wild-rift": { requiresServer: false, template: "{user_id}" },
  "legends-of-runeterra": { requiresServer: false, template: "{user_id}" },
  "teamfight-tactics-mobile": { requiresServer: false, template: "{user_id}" },
  "efootball": { requiresServer: false, template: "{user_id}" },
  "point-blank": { requiresServer: false, template: "{user_id}" },
  "roblox": { requiresServer: false, template: "{user_id}" },

  // ── Nomor HP ───────────────────────────────────────────────────────────
  "vidio": { requiresServer: false, template: "{user_id}" },
  "telkomsel": { requiresServer: false, template: "{user_id}" },
  "indosat": { requiresServer: false, template: "{user_id}" },
  "axis": { requiresServer: false, template: "{user_id}" },
  "tri": { requiresServer: false, template: "{user_id}" },
  "xl": { requiresServer: false, template: "{user_id}" },
  "smartfren": { requiresServer: false, template: "{user_id}" },
  "by-u": { requiresServer: false, template: "{user_id}" },
  "dana": { requiresServer: false, template: "{user_id}" },
  "go-pay": { requiresServer: false, template: "{user_id}" },
  "ovo": { requiresServer: false, template: "{user_id}" },
  "shopee-pay": { requiresServer: false, template: "{user_id}" },

  // ── Tagihan ────────────────────────────────────────────────────────────
  "pln": { requiresServer: false, template: "{user_id}" },
  "pertamina-gas": { requiresServer: false, template: "{user_id}" },
  "k-vision-dan-gol": { requiresServer: false, template: "{user_id}" },

  // ── Voucher: SN kode adalah produknya, customer_no cukup kontak referensi ─
  "steam-wallet": { requiresServer: false, template: "{user_id}" },
  "steam-wallet-idr": { requiresServer: false, template: "{user_id}" },
  "google-play-indonesia": { requiresServer: false, template: "{user_id}" },
  "playstation": { requiresServer: false, template: "{user_id}" },
  "garena": { requiresServer: false, template: "{user_id}" },
  // Deskripsi Xbox di Digiflazz tidak menyebut target sama sekali, tapi API
  // Digiflazz mewajibkan customer_no — email atau nomor HP dipakai sebagai
  // kontak referensi, sama seperti voucher lain.
  "xbox": { requiresServer: false, template: "{user_id}" },
};

/**
 * Target kurasi untuk satu game id, atau null kalau belum diverifikasi.
 */
export function getCuratedGameTarget(gameId: string): GameFulfillmentTarget | null {
  return CURATED_GAME_TARGETS[gameId] ?? null;
}

/**
 * Game aktif yang punya `checker` tapi belum punya template.
 *
 * Dipakai test supaya game baru yang belum dimasukkan ke peta kurasi ketahuan
 * sebelum sempat jadi order yang gagal di supplier.
 */
export function gamesMissingCuratedTarget(activeGameIds: string[]) {
  return activeGameIds
    .filter((id) => {
      const target = CURATED_GAME_TARGETS[id];
      return !target || !target.template;
    })
    .sort();
}