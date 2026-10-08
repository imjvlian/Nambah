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
   *   "Format no tujuan [UID]|[Server]"            -> pemisah `|` (Genshin,
   *       Wuthering Waves, Zenless Zone Zero, Honkai Star Rail, Heroes Evolved,
   *       Dragon Nest M Classic)
   *   "Masukkan ID dan Server"                     -> pemisah `|` (Ragnarok M,
   *       NBA Infinite). Ragnarok M punya contoh supplier `123378499|Eternal
   *       Love` yang memakai `|`; NBA Infinite memakai asumsi yang sama karena
   *       deskripsinya identik dan belum pernah dites live.
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
  // Genshin Impact dan Wuthering Waves sebelumnya `{user_id}` padahal
  // `requires_server` true. Itu bukan sekadar membuang pilihan pelanggan —
  // `renderFulfillmentTarget` melempar error "Produk membutuhkan server tetapi
  // template tidak memiliki {server_id}", jadi SETIAP order kedua game itu
  // gagal saat fulfillment.
  "genshin-impact": { requiresServer: true, template: "{user_id}|{server_id}" },
  "wuthering-waves": { requiresServer: true, template: "{user_id}|{server_id}" },
  "zenless-zone-zero": { requiresServer: true, template: "{user_id}|{server_id}" },
  "honkai-star-rail": { requiresServer: true, template: "{user_id}|{server_id}" },
  "heroes-evolved": { requiresServer: true, template: "{user_id}|{server_id}" },
  "dragon-nest-m-classic": { requiresServer: true, template: "{user_id}|{server_id}" },

  // Ragnarok M dan NBA Infinite: "Masukkan ID dan Server". Ragnarok M punya
  // contoh supplier `123378499|Eternal Love` yang memakai `|`. NBA Infinite
  // memakai pemisah yang sama karena deskripsinya sama persis — ASUMSI, belum
  // ada order live yang membuktikan.
  "ragnarok-m-eternal-love": { requiresServer: true, template: "{user_id}|{server_id}" },
  "nba-infinite": { requiresServer: true, template: "{user_id}|{server_id}" },

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