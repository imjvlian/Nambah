/**
 * Pemetaan ID game Nambah -> `game_code` Melostore check-nickname.
 *
 * Sumber data: GET https://api.melostore.id/api/v1/h2h/check-nickname/games
 * (endpoint publik, diambil 17 Oktober 2026 — 215 game + 6 e-wallet).
 *
 * HANYA game dengan konsep nickname yang dipetakan. Voucher/pulsa/tagihan
 * tidak punya checker (`getGameAccountSchema().checker === null`), jadi
 * tidak pernah sampai ke pemetaan ini.
 *
 * TIGA KELOMPOK:
 *
 * 1. Terpetakan + konsisten  -> gate memanggil Melostore.
 * 2. RESIDUAL_UNVERIFIABLE_GAMES (5 game) -> sengaja fail-open dengan risk
 *    acceptance tertulis (keputusan owner 17 Okt 2026): tidak ada provider
 *    verifikasi di pasar untuk game ini. Free Fire MAX dan Roblox termasuk
 *    di sini — menyembunyikan mereka dari katalog berarti kehilangan
 *    revenue nyata.
 * 3. Tidak terpetakan (mis. efootball, ragnarok-m-eternal-love) -> juga
 *    fail-open, TAPI dengan alarm gap di /api/admin/readiness supaya tidak
 *    jadi lubang senyap. Bedanya dengan kelompok 2: belum ada keputusan
 *    bisnis yang menerima gap ini.
 *
 * GAME YANG TIDAK DIPETAKAN PADAHAL CODE-NYA ADA:
 *
 * Beberapa code Melostore menuntut `customer_target_zone`, padahal form
 * Nambah tidak mengumpulkan server untuk game itu (valorant-indonesia,
 * marvel-rivals, one-punch-man-the-strongest, tom-and-jerry-chase). Merek
 * tetap ada di MELOSTORE_GAME_CODES, tapi engine menandainya gap kalau
 * zone-nya tidak tersedia — verifikasi yang pasti gagal lebih buruk
 * daripada tidak memverifikasi.
 */

export const RESIDUAL_UNVERIFIABLE_GAMES: readonly string[] = [
  "aniimo",
  "free-fire-max",
  "lords-mobile",
  "roblox",
  "werewolf-party-game",
];

export const MELOSTORE_GAME_CODES: Readonly<Record<string, string>> = {
  "arena-of-valor": "arena-of-valor-indonesia",
  "au2-mobile": "au2-mobile",
  "call-of-duty-mobile": "call-of-duty-mobile-indonesia",
  "delta-force": "delta-force",
  "dragon-nest-m-classic": "dragon-nest-m-classic",
  "fc-mobile": "ea-sports-fc-mobile-indonesia",
  "free-fire": "free-fire",
  "genshin-impact": "genshin-impact",
  "heroes-evolved": "heroes-evolved",
  "honkai-star-rail": "honkai-star-rail",
  "honor-of-kings": "honor-of-kings",
  "laplace-m": "laplace-m",
  "league-of-legends-pc": "league-of-legends",
  "league-of-legends-wild-rift": "league-of-legends-wild-rift",
  "legends-of-runeterra": "legends-of-runeterra",
  "lifeafter-credits": "lifeafter",
  "magic-chess": "magic-chess-go-go",
  "marvel-rivals": "marvel-rivals",
  "mobile-legends": "mobile-legends",
  "mobile-legends-adventure": "mobile-legends-adventure",
  "nba-infinite": "nba-infinite",
  "one-punch-man": "one-punch-man-the-strongest",
  "point-blank": "point-blank",
  "pubg-mobile": "pubg-mobile",
  "speed-drifters": "speed-drifters",
  "state-of-survival": "state-of-survival",
  "teamfight-tactics-mobile": "teamfight-tactics-mobile",
  "tom-and-jerry-chase": "tom-and-jerry-chase",
  "valorant": "valorant-indonesia",
  "where-winds-meet": "where-winds-meet",
  "wuthering-waves": "wuthering-waves",
  "zenless-zone-zero": "zenless-zone-zero",

  /*
   * ── E-wallet (P1.6, 21 Okt 2026) ──────────────────────────────────────
   *
   * Cek nama pemilik akun via check-nickname — sumber: endpoint publik
   * /check-nickname/games (diambil 17 Okt 2026, 6 e-wallet): gopay,
   * dana, ovo, shopeepay, isaku, linkaja. Semua zone_required: false.
   *
   * ID game Nambah: slug dari brand katalog (Digiflazz maupun
   * Melostore) — "dana", "gopay", dst. "i-saku" dicover juga karena
   * brand "i.saku" di-slugify jadi itu.
   */
  dana: "dana",
  ovo: "ovo",
  /*
   * ID game di database memakai tanda hubung (konfirmasi SQL owner 21
   * Okt): "go-pay", "shopee-pay" — bukan slug satu kata. Keduanya
   * dicover, plus varian satu kata untuk berjaga.
   */
  "go-pay": "gopay",
  gopay: "gopay",
  "shopee-pay": "shopeepay",
  shopeepay: "shopeepay",
  linkaja: "linkaja",
  isaku: "isaku",
  "i-saku": "isaku",
};

/**
 * `game_code` Melostore yang menuntut `customer_target_zone` pada cek
 * (field `zone_required` dari /check-nickname/games). Dipakai engine untuk
 * mendeteksi mismatch: Melostore minta zone tapi form Nambah tidak
 * mengumpulkannya -> verifikasi tidak mungkin dijalankan.
 */
export const MELOSTORE_ZONE_REQUIRED_CODES: ReadonlySet<string> = new Set([
  "dragon-nest-m-classic",
  "genshin-impact",
  "heroes-evolved",
  "honkai-star-rail",
  "magic-chess-go-go",
  "marvel-rivals",
  "mobile-legends",
  "mobile-legends-adventure",
  "nba-infinite",
  "one-punch-man-the-strongest",
  "tom-and-jerry-chase",
  "valorant-indonesia",
  "where-winds-meet",
  "wuthering-waves",
  "zenless-zone-zero",
]);

export function getMelostoreGameCode(gameId: string): string | null {
  const code = MELOSTORE_GAME_CODES[gameId];
  return typeof code === "string" && code ? code : null;
}

export function melostoreCodeRequiresZone(code: string): boolean {
  return MELOSTORE_ZONE_REQUIRED_CODES.has(code);
}

export function isResidualUnverifiableGame(gameId: string): boolean {
  return RESIDUAL_UNVERIFIABLE_GAMES.includes(gameId);
}
