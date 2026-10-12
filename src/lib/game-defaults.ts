/**
 * Dasar-dasar baris `games` untuk supplier selain Digiflazz.
 *
 * MODUL MURNI - tanpa I/O. Test menulis semua keadaan tanpa server.
 *
 * KENAPA MODUL TERPISAH, BUKKAN MENYALIN DARI ROUTE PUBLISH DIGIFLAZZ
 *
 * Route publish punya salinannya sendiri dan berjalan di produksi;
 * menyentuhnya demi dipakai bersama berarti menggabungkan dua risiko.
 * Modul ini milik jalur supplier kedua - dan punya satu peningkatan
 * yang tidak dimiliki versi Digiflazz: `requires_server` disimpulkan
 * dari INQUIRY FORM supplier (field kedua zone/server), bukan dari
 * daftar nama game yang harus diperbarui manual setiap ada game baru.
 */

/** Normalisasi teks untuk perbandingan nama. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Slug id game dari nama brand: "MONGIL: STAR DIVE" -> "mongil-star-dive". */
export function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Kapitalisasi judul: "MONGIL: STAR DIVE" -> "Mongil: Star Dive".
 *
 * Huruf pertama KATA yang dikapital, bukan karakter pertama - kata
 * berawalan tanda baca seperti "(global)" tetap menjadi "(Global)",
 * bukan "(global)" (terbukti di uji nyata sebelum perbaikan ini).
 */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[a-z]/, (c) => c.toUpperCase()))
    .join(" ");
}

/** Dua huruf awal sebagai inisial untuk ikon. */
export function makeInitials(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
  }
  return value.slice(0, 2).toUpperCase();
}

/**
 * Warna aksen stabil untuk game baru.
 *
 * Hash sederhana: nama yang sama selalu mendapat warna sama di semua
 * server dan semua proses - penting karena nilai ini disimpan ke baris
 * game, bukan dihitung ulang saat render.
 */
export function stableAccent(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 68% 61%)`;
}

/**
 * Kategori baris game dari kategori katalog supplier.
 *
 * Melostore memakai "Game", "Gift Card", "Social", "Ewallet" - hanya
 * yang menyebut "game" yang layak jadi kategori game; sisanya voucher.
 */
export function inferKategori(kategoriKatalog: string): "game" | "voucher" {
  return /game/i.test(kategoriKatalog) ? "game" : "voucher";
}

export type FieldForm = {
  key: string;
  name: string;
  type: string;
};

/**
 * Apakah game ini butuh kolom server di form checkout.
 *
 * SIMPULAN DARI INQUIRY FORM, BUKAN DARI NAMA GAME.
 *
 * Form dengan field kedua yang menyebut zone/server (kuncinya
 * "target_zone", labelnya "Zone"/"Server ID") berarti supplier
 * mengirim ke wilayah tertentu - checkout wajib mengumpulkannya.
 * Form satu field ("Player ID" saja) berarti tidak. Versi lama jalur
 * Digiflazz menebak dari dua nama game; setiap game baru harus
 * diperbarui manual - simpulan dari data tidak punya kelemahan itu.
 */
export function butuhServerDariForm(fields: FieldForm[] | null | undefined): boolean {
  if (!fields || fields.length < 2) return false;
  const kedua = fields[1];
  if (!kedua) return false;
  return /zone|server|region/i.test(kedua.key) || /zone|server|region/i.test(kedua.name);
}

export type GameCandidateRow = {
  id: string;
  name: string;
  short_name: string;
};

/**
 * Cari game yang sudah ada untuk sebuah brand.
 *
 * Tiga kecocokan, urut paling kuat: id sama dengan slug brand, nama
 * sama, short_name sama (semuanya dinormalisasi). Brand "Free Fire
 * (Global)" tidak akan cocok dengan game "Free Fire" - keduanya memang
 * brand yang berbeda di katalog supplier, dan operator yang ingin
 * menggabungkan tetap bisa memilih manual lewat dropdown.
 */
export function cariGameCocok(
  brand: string,
  games: readonly GameCandidateRow[],
): GameCandidateRow | null {
  const slug = slugify(brand);
  const target = normalizeText(brand);
  if (!target) return null;

  for (const game of games) {
    if (slug && game.id === slug) return game;
  }
  for (const game of games) {
    if (normalizeText(game.name) === target) return game;
  }
  for (const game of games) {
    if (normalizeText(game.short_name) === target) return game;
  }
  return null;
}

export type GameBaruDefaults = {
  id: string;
  name: string;
  shortName: string;
  category: "game" | "voucher";
  accent: string;
  initials: string;
  requiresServer: boolean;
  /** Selalu null: template belum diverifikasi, readiness menandainya blocker. */
  fulfillmentTargetTemplate: null;
};

/**
 * Dasar baris game baru dari brand katalog supplier.
 *
 * `brand` kosong atau hanya tanda baca menghasilkan null - membuat game
 * tanpa nama yang bisa dibaca berarti membuat baris yang tidak bisa
 * dicari siapa pun lewat panel admin.
 */
export function buatGameBaruDefaults(input: {
  brand: string;
  kategoriKatalog: string;
  fieldsForm: FieldForm[] | null | undefined;
  /** Pengenal cadangan kalau slug brand kosong, mis. SKU supplier. */
  fallbackId?: string;
}): GameBaruDefaults | null {
  const brand = input.brand?.trim() ?? "";
  if (!brand) return null;

  const name = titleCase(brand);
  const id = slugify(brand) || slugify(input.fallbackId ?? "game-baru") || "game-baru";
  const initials = makeInitials(name);

  return {
    id,
    name,
    shortName: name.length <= 18 ? name : initials,
    category: inferKategori(input.kategoriKatalog),
    accent: stableAccent(brand),
    initials,
    requiresServer: butuhServerDariForm(input.fieldsForm),
    fulfillmentTargetTemplate: null,
  };
}
