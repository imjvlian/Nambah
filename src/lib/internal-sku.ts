/**
 * Generator SKU internal Lacte Game Store.
 *
 * MODUL MURNI - tanpa I/O. Semua keputusan bisa diuji tanpa database.
 *
 * KENAPA SKU INTERNAL, BUKAN PAKAI ID PRODUK
 *
 * Semua produk Nambah lahir dari sinkronisasi Digiflazz: id-nya
 * `df-<sku digiflazz>-<hash>`. Itu berarti id produk MEMBAWA kode
 * Digiflazz di dalamnya - dan kalau kode itu dipakai sebagai identitas
 * utama, Nambah tidak pernah punya identitas sendiri. Menambah supplier
 * kedua dengan kondisi itu berarti identitas produk bergantung pada
 * salah satu suppliernya.
 *
 * SKU internal adalah identitas yang bebas dari supplier mana pun.
 * Checkout TETAP memakai `products.id` (jangan mengubah itu - seluruh
 * foreign key order menunjuk ke sana); SKU internal dipakai sebagai
 * penanda yang dibaca manusia dan yang tidak berubah ketika mapping
 * supplier diganti.
 *
 * KENAPA TIDAK MENGGANTI SKU LAMA
 *
 * Mengisi ulang SKU produk yang sudah punya SKU akan merusak rekam jejak:
 * laporan, nota, dan komunikasi yang menyebut SKU lama menjadi salah.
 * Generator hanya mengisi yang KOSONG. Perubahan harga, gambar, status,
 * dan deskripsi tidak pernah menyentuh SKU.
 */

/**
 * Alias brand yang disetel manual.
 *
 * Urutan nama game -> alias. Nama-nama besar punya singkatan yang sudah
 * dipakai manusia sehari-hari; menurunkannya dari nama lengkap akan
 * menghasilkan "MOBILE_LEGENDES" yang tidak pernah dipakai siapa pun.
 *
 * Kunci di sini adalah `games.id` (slug), bukan nama tampilan - karena
 * slug yang stabil, sedangkan nama tampilan bisa diubah admin.
 */
const BRAND_ALIAS: Record<string, string> = {
  "mobile-legends": "MLBB",
  "mobile-legends-adventure": "MLBB-ADVENTURE",
  "free-fire": "FF",
  "free-fire-max": "FFMAX",
  "pubg-mobile": "PUBGM",
  "pubg-new-state-mobile": "PUBGNS",
  "genshin-impact": "GI",
  "honkai-star-rail": "HSR",
  "honor-of-kings": "HOK",
  valorant: "VALORANT",
  "league-of-legends-wild-rift": "LOLWR",
  "league-of-legends-pc": "LOLPC",
  "call-of-duty-mobile": "CODM",
  "arena-of-valor": "AOV",
  "zenless-zone-zero": "ZZZ",
  "wuthering-waves": "WUWA",
  "tower-of-fantasy": "TOF",
  "point-blank": "PB",
  zepeto: "ZEPETO",
  "steam-wallet": "STEAM",
  "steam-wallet-idr": "STEAM-IDR",
  "google-play-indonesia": "GOOGLEPLAY",
};

/**
 * Normalisasi nama produk menjadi bagian SKU.
 *
 * ATURAN
 *
 * - Huruf besar semua.
 * - Pemisah ribuan gaya Indonesia dihilangkan lebih dulu: "1.050"
 *   adalah seribu lima puluh, dan membiarkan titiknya menghasilkan
 *   "1-050" yang terbaca sebagai dua angka.
 * - Karakter bukan huruf/angka menjadi tanda hubung, lalu yang
 *   bertumpuk disatukan. "50 Diamonds" dan "50  diamonds" harus
 *   menghasilkan SKU yang sama.
 * - Tanda hubung di awal/akhir dibuang, supaya label simbol saja tidak
 *   menghasilkan SKU yang diakhiri garis.
 *
 * Yang TIDAK dilakukan: mengubah jamak menjadi tunggal. Contoh spesifikasi
 * memakai "60 Genesis Crystals" -> GI-60-GENESIS-CRYSTALS, jadi label
 * dipertahankan apa adanya - menyatukan "Diamond" dan "Diamonds" justru
 * membuat SKU tidak lagi cocok dengan label yang ditampilkan.
 */
export function normalizeProductLabel(label: string): string {
  return String(label ?? "")
    .trim()
    .replace(/(?<=\d)\.(?=\d{3}\b)/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Alias brand untuk game tertentu.
 *
 * Fallback: slug game diubah jadi huruf besar dengan garis bawah.
 * `call-of-duty-mobile` menjadi "CALL_OF_DUTY_MOBILE" - panjang, tapi
 * deterministik, unik, dan tidak memakai tanda hubung di dalam bagian
 * brand (tanda hubung adalah pemisah antar bagian SKU).
 */
export function brandAlias(gameId: string): string {
  const curated = BRAND_ALIAS[String(gameId ?? "").trim()];
  if (curated) return curated;

  const fallback = String(gameId ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return fallback || "PRODUK";
}

/**
 * SKU internal utuh: `<BRAND>-<NAMA PRODUK>`.
 *
 * Mengembalikan `null` kalau hasilnya tidak layak dipakai - label kosong
 * atau brand kosong. Mengarang SKU dari input kosong berarti membuat
 * identitas yang tidak bisa dilacak kembali ke produknya.
 */
export function generateInternalSku(
  gameId: string,
  productLabel: string,
): string | null {
  const brand = brandAlias(gameId);
  const produk = normalizeProductLabel(productLabel);

  if (!brand || !produk) return null;

  const sku = `${brand}-${produk}`;
  // SKU yang tidak masuk akal panjangnya lebih baik ditolak daripada
  // disimpan: batas kolom dan keterbacaan di laporan sama-sama penting.
  if (sku.length > 120) return null;

  return sku;
}

/**
 * SKU dengan akhiran unik.
 *
 * Dipakai saat dua produk ternyata menghasilkan SKU yang sama - misalnya
 * dua SKU Digiflazz berbeda untuk "50 Diamonds" di game yang sama.
 * Spesifikasi melarang menimpa produk yang sudah ada; akhiran angka
 * membuat keduanya tetap punya SKU sendiri tanpa mengubah yang lama.
 *
 * Mulai dari 2: produk pertama tidak perlu akhiran, dan "-1" hanya akan
 * menambah kebisingan tanpa informasi.
 */
export function internalSkuWithSuffix(
  gameId: string,
  productLabel: string,
  suffix: number,
): string | null {
  if (!Number.isInteger(suffix) || suffix < 2) return null;

  const dasar = generateInternalSku(gameId, productLabel);
  if (!dasar) return null;

  return `${dasar}-${suffix}`;
}