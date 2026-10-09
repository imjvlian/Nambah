/**
 * Sumber tunggal identitas brand.
 *
 * Rebrand dari "Nambah" ke "Lacte Game Store" (2026-10-10).
 *
 * CATATAN PENTING — apa yang SENGAJA tidak diubah:
 *
 * `domain` dan `url` tetap `nambah.id`. Rebrand ini belum termasuk migrasi
 * domain: `nambah.id` sudah terindeks Google dan punya backlink. Mengganti
 * domain berarti kehilangan seluruh SEO historis dan butuh redirect plus
 * perubahan env var email pengirim yang belum siap. Itu keputusan terpisah.
 *
 * `shortName` ("Lacte") dipakai di tempat yang tidak muat nama panjang —
 * navbar sempit, chip, label admin. Nama program loyalitas ("Lacte Points")
 * dibentuk dari shortName ini, jadi kalau nanti shortName berubah, cukup ubah
 * satu baris di bawah.
 *
 * ATURAN: brand tidak boleh ditulis langsung di file mana pun. Selalu pakai
 * `BRAND.name`. Kalau ada string "Nambah" yang benar-benar meant to be brand
 * di luar file ini, itu bug.
 */
export const BRAND = {
  name: "Lacte Game Store",
  shortName: "Lacte",
  tagline: "Semua game, satu tempat.",
  domain: "nambah.id",
  url: "https://nambah.id",
  description:
    "Top up game cepat, aman, dan harga terjangkau. Semua game, satu tempat.",
  themeColor: "#0a0b0a",
  backgroundColor: "#0a0b0a",
  brandColor: "#c9ff3f",
  brandInk: "#11130f",
  colors: {
    lime: { 50: "#f6ffe5", 100: "#eeffcc", 200: "#ddff99", 300: "#cbff66", 400: "#baff33", 500: "#c9ff3f", 600: "#b6e636", 700: "#9dcc22", 800: "#7fa31b", 900: "#5f7f16" },
  },
} as const;

export type Brand = typeof BRAND;

/**
 * Nama program loyalitas.
 *
 * Dahulu "Nambah Points". Diturunkan dari `shortName` supaya rebrand
 * berikutnya cukup mengubah satu nilai di atas.
 *
 * Kolom database TIDAK ikut berubah — ini murni label yang ditampilkan ke
 * pengguna. Jangan samakan dengan nama tabel/kolom (`point_lots` dan
 * sejenisnya) yang memang sengaja dibiarkan.
 */
export const LOYALTY_PROGRAM_NAME = `${BRAND.shortName} Points`;