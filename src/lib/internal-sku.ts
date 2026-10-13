/**
 * Generator SKU internal Lacte Game Store.
 *
 * FORMAT: `GAME-JENIS-NOMINAL` (mis. MLBB-DM-56, FF-DM-70, PUBGM-UC-60).
 *
 * Tiga bagian itu dipisah sengaja: identitas produk terletak pada
 * kombinasi ketiganya, bukan pada nama. "56 Diamonds" dari game berbeda
 * menghasilkan SKU berbeda karena bagian GAME; "50 Diamonds" dan "56
 * Diamonds" dari game sama berbeda karena NOMINAL. Nama panjang seperti
 * "Weekly Elite Bundle" tidak muat dalam pola itu - untuk produk tanpa
 * nominal, bagian NOMINAL diisi sisa nama produk.
 *
 * KENAPA FORMAT TERSTRUKTUR, BUKAN NAMA PRODUK UTUH
 *
 * Supplier menulis nama berbeda untuk barang yang sama ("50 Diamonds",
 * "50 Diamond", "50d"). SKU yang diturunkan dari nama utuh mewarisi
 * perbedaan itu. Dengan memisahkan JENIS dan NOMINAL, dua penulisan
 * berbeda untuk barang yang sama jatuh ke SKU yang sama - dan perbedaan
 * nominal tetap menghasilkan SKU berbeda.
 *
 * REGION: produk yang sama untuk wilayah berbeda adalah produk berbeda
 * (diamond Malaysia tidak bisa dipakai akun Indonesia). Wilayah utama
 * tidak diberi akhiran; yang menyimpang diberi akhiran - supaya
 * MLBB-DM-56 (Indonesia) dan MLBB-DM-56-MY tetap terlihat sebagai satu
 * keluarga.
 *
 * KENAPA TIDAK MENGGANTI SKU LAMA
 *
 * Generator hanya mengisi yang KOSONG. Mengubah SKU yang sudah tersebar
 * di nota dan laporan berarti mematahkan rekam jejaknya.
 */

/**
 * Alias brand per game.
 *
 * Nama besar punya singkatan yang dipakai manusia sehari-hari; menurunkan
 * alias dari nama lengkap menghasilkan "MOBILE_LEGENDS" yang tidak pernah
 * dipakai siapa pun. Kunci di sini adalah `games.id` (slug), karena slug
 * yang stabil sedangkan nama tampilan bisa diubah admin.
 */
const BRAND_ALIAS: Record<string, string> = {
  "mobile-legends": "MLBB",
  "mobile-legends-adventure": "MLBBADV",
  "free-fire": "FF",
  "free-fire-max": "FFMAX",
  "pubg-mobile": "PUBGM",
  "pubg-new-state-mobile": "PUBGNS",
  "genshin-impact": "GI",
  "honkai-star-rail": "HSR",
  "honor-of-kings": "HOK",
  "valorant": "VALO",
  "league-of-legends-wild-rift": "LOLWR",
  "call-of-duty-mobile": "CODM",
  "arena-of-valor": "AOV",
  "zenless-zone-zero": "ZZZ",
  "wuthering-waves": "WUWA",
  "tower-of-fantasy": "TOF",
  "point-blank": "PB",
  "zepeto": "ZEP",
  "steam-wallet": "STEAM",
  "magic-chess": "MAGICCHESS",
};

/**
 * Jenis produk -> kode singkat.
 *
 * Kunci dipakai untuk mengenali jenis dari nama produk atau kolom `type`
 * supplier. Nilainya kode yang tetap pendek - menurunkan kode dari nama
 * jenis akan menghasilkan "DIAMONDS" yang memanjangkan SKU tanpa
 * menambah informasi.
 */
const JENIS_KODE: Record<string, string> = {
  diamond: "DM",
  diamonds: "DM",
  dm: "DM",
  uc: "UC",
  point: "PT",
  points: "PT",
  coin: "COIN",
  coins: "COIN",
  gem: "GEM",
  gems: "GEM",
  crystal: "CRYSTAL",
  crystals: "CRYSTAL",
  voucher: "VCH",
  token: "TOKEN",
  tokens: "TOKEN",
  pass: "PASS",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  bundle: "BUNDLE",
  shell: "SHELL",
  gold: "GOLD",
};

/**
 * Wilayah yang tersirat dari prefiks SKU Melostore.
 *
 * Melostore menaruh wilayah di awal SKU (mlid = Indonesia, mlmy =
 * Malaysia). Wilayah utama - Indonesia, pasar utama Nambah - tidak
 * diberi akhiran supaya SKU terpendek jatuh ke produk yang paling sering
 * dijual; yang menyimpang diberi akhiran.
 */
const REGION_BY_PREFIX: Record<string, string> = {
  mlmy: "MY",
  mlph: "PH",
  mlbr: "BR",
  mlus: "US",
  mlgl: "GL",
  ffmy: "MY",
  ffbr: "BR",
  ffg: "GL",
  pubgmgl: "GL",
};

/** Wilayah utama: tidak diberi akhiran. */
const REGION_DEFAULT = "ID";

/** Wilayah dari SKU supplier, atau null kalau tidak terbaca. */
export function regionFromSupplierSku(sku: string): string | null {
  const s = String(sku ?? "").trim().toLowerCase();

  // Prefiks yang eksplisit menyebut Indonesia tidak butuh akhiran.
  if (/^(mlid|ffid|pubgmid)/.test(s)) return null;

  /*
   * STARTS WITH PREFIKS YANG DIKETAHUI, bukan ekstraksi `^([a-z]+)`.
   *
   * Ekstraksi rakus membaca "mlmyfr100d-s2" sebagai prefiks "mlmyfr" -
   * yang tidak ada di daftar mana pun - sehingga wilayahnya lenyap dan
   * SKU turunan kehilangan akhiran -MY. Akibatnya SKU First Top Up
   * Malaysia cocok ke produk diamond biasa Indonesia (terbukti di uji
   * nyata: 7 pemetaan salah terpasang sebelum perbaikan ini).
   *
   * Prefiks terpanjang diperiksa lebih dulu supaya prefiks yang merupakan
   * awalan prefiks lain (pubgmgl vs pubgm) tidak terbaca lebih pendek.
   */
  const prefiksRegional = Object.keys(REGION_BY_PREFIX).sort(
    (a, b) => b.length - a.length,
  );
  for (const prefiks of prefiksRegional) {
    if (s.startsWith(prefiks)) {
      const region = REGION_BY_PREFIX[prefiks];
      if (region && region !== REGION_DEFAULT) return region;
      return null;
    }
  }
  return null;
}

/** Jenis produk dari kolom `type` supplier atau dari nama produk. */
export function jenisFromSupplier(
  type: string | null | undefined,
  label: string | null | undefined,
): string | null {
  const periksa = (value: string | null | undefined) => {
    if (typeof value !== "string") return null;
    const words = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    for (const word of words) {
      const kode = JENIS_KODE[word];
      if (kode) return kode;
    }
    return null;
  };

  return periksa(type) ?? periksa(label);
}

/**
 * Nominal dari nama produk.
 *
 * ATURAN "A + B": JUMLAH, bukan max.
 *
 * "40 + 4 Diamonds" berarti 40 dasar + 4 bonus = 44 total. Melostore
 * memakai jumlah itu di SKU code-nya sendiri (mlus44d), dan Digiflazz
 * menyebut produk yang sama sebagai "44 Diamonds" - kalau kita pakai
 * max (40), dua barang yang sama menghasilkan identitas berbeda dan
 * merge tidak akan pernah menemukannya.
 *
 * Tanpa "+": ANGKA TERBESAR.
 *
 * "2x 50 Diamonds" menyebut dua angka tanpa "+", dan yang
 * mengidentifikasi produk adalah 50, bukan 2. "1.050 Diamonds" adalah
 * seribu lima puluh - pemisah ribuan dihilangkan lebih dulu, kalau
 * tidak angkanya terbaca "1" dan "050" terpisah.
 *
 * "11 Diamonds (10 + 1 Bonus)": total 11 sudah TERTULIS sebelum
 * tanda kurung. Pola "+" ditemukan lebih dulu (10+1=11) dan hasilnya
 * sama - kalau kedua angka di dalam kurung konsisten dengan total,
 * tidak ada perbedaan. Yang penting: pola "+" TIDAK diabaikan hanya
 * karena ada angka lain di label.
 *
 * "Weekly Pass" tidak punya nominal sama sekali - dan itu bukan
 * kegagalan.
 */
export function nominalFromLabel(
  label: string | null | undefined,
): number | null {
  if (typeof label !== "string") return null;

  const bersih = label.replace(/(?<=\d)\.(?=\d{3}\b)/g, "");

  /*
   * Cari "A + B" - angka dipisah tanda plus, spasi opsional.
   * Hanya pasangan PERTAMA yang diambil: "50 + 5 + 3" jarang ada,
   * dan mengambil lebih dari satu "+" membuat hasil bergantung
   * pada urutan parsing yang tidak bisa ditebak.
   */
  const plus = bersih.match(/(\d[\d,]*)\s*\+\s*(\d[\d,]*)/);
  if (plus) {
    const a = Number(plus[1]!.replace(/,/g, ""));
    const b = Number(plus[2]!.replace(/,/g, ""));
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return a + b;
    }
  }

  const angka = [...bersih.matchAll(/\d[\d,]*/g)]
    .map((m) => Number(m[0].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));

  if (angka.length === 0) return null;
  return Math.max(...angka);
}

/**
 * Kata identitas produk tanpa angka: kata terakhir yang bukan kata
 * jenis PERTAMA.
 *
 * "Weekly Pass"        -> PASS   (weekly jenisnya, pass identitasnya)
 * "Weekly Diamond Pass" -> PASS (diamond hanya keterangan isi)
 * "Special Bundle"      -> SPECIAL (bundle adalah jenis)
 *
 * HANYA kata jenis PERTAMA yang dikeluarkan. Mengeluarkan semua kata
 * yang dikenal sebagai jenis akan membuang identitasnya sendiri:
 * "Weekly Pass" lenyap jadi ITEM karena "pass" juga ada di daftar
 * jenis.
 */
function kataIdentitas(label: string): string {
  const kata = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const indeksJenis = kata.findIndex((w) => JENIS_KODE[w] !== undefined);
  const sisa =
    indeksJenis >= 0 ? kata.filter((_, i) => i !== indeksJenis) : kata;

  return (sisa.at(-1) ?? "").toUpperCase();
}

export type InternalSkuInput = {
  gameId: string;
  /** Nama produk dari supplier atau label internal. */
  label: string;
  /** Kolom `type` supplier, kalau ada - lebih andal daripada nama. */
  jenis?: string | null;
  /** Wilayah eksplisit; kalau kosong, ditebak dari SKU supplier. */
  region?: string | null;
  /** SKU supplier, untuk menebak wilayah. */
  supplierSku?: string;
};

/**
 * SKU internal utuh: `GAME-JENIS-NOMINAL[-REGION]`.
 *
 * Mengembalikan `null` kalau input tidak layak - brand atau label kosong.
 * Mengarang SKU dari input kosong berarti membuat identitas yang tidak
 * bisa dilacak kembali ke produknya.
 */
export function generateInternalSku(
  input: InternalSkuInput,
  supplierSku?: string,
): string | null {
  const brand = brandAlias(input.gameId);
  const label = String(input.label ?? "").trim();

  if (!brand || !label) return null;

  const jenis = jenisFromSupplier(input.jenis, label) ?? "ITEM";

  const nominal = nominalFromLabel(label);
  const region =
    input.region ??
    regionFromSupplierSku(input.supplierSku ?? supplierSku ?? "");

  // Bagian NOMINAL: angka kalau ada, kalau tidak sisa nama produk.
  const nominalPart =
    nominal !== null ? String(nominal) : kataIdentitas(label) || "ITEM";

  const parts = [brand, jenis, nominalPart];
  /* Wilayah utama (ID) tidak pernah menjadi akhiran - juga untuk region
   * yang ditetapkan admin eksplisit, supaya produk Indonesia tidak
   * berakhiran ganda sementara wilayah lain tidak. */
  if (region && region !== "ID") parts.push(region);

  const sku = parts.join("-");
  if (sku.length > 120) return null;

  return sku;
}

/**
 * SKU dengan akhiran unik.
 *
 * Dipakai saat dua produk ternyata menghasilkan SKU yang sama - misalnya
 * dua SKU Digiflazz berbeda untuk "50 Diamonds" di game yang sama.
 * Spesifikasi melarang menimpa produk yang sudah ada; akhiran membuat
 * keduanya tetap punya SKU sendiri tanpa menyentuh yang terlanjur ada.
 * Mulai dari 2 karena produk pertama tidak butuh akhiran.
 */
export function internalSkuWithSuffix(
  input: InternalSkuInput,
  suffix: number,
  supplierSku?: string,
): string | null {
  if (!Number.isInteger(suffix) || suffix < 2) return null;

  const dasar = generateInternalSku(input, supplierSku);
  if (!dasar) return null;

  return `${dasar}-${suffix}`;
}

/**
 * SKU internal pertama yang masih bebas, atau null.
 *
 * Satu-satunya cara pemanggil mendapat SKU yang AMAN dipasang ke produk
 * baru tanpa menimpa yang lama: mulai dari SKU dasar, lalu akhiran 2..49
 * sampai ketemu yang tidak ada di daftar `dipakai`.
 *
 * `dipakai` bisa berupa Set di memori (sync yang menghitung batch) atau
 * pemeriksaan database (publish satu-per-satu) - asal jawab "true kalau
 * SKU ini sudah dipegang produk lain".
 *
 * Pemanggil WAJIB menambahkan hasilnya ke `dipakai` sendiri - fungsi ini
 * murni dan tidak menyimpan apa pun, supaya bisa diuji tanpa I/O.
 */
export function skuInternalBebas(
  input: InternalSkuInput,
  dipakai: { has: (sku: string) => boolean },
  supplierSku?: string,
): string | null {
  const dasar = generateInternalSku(input, supplierSku);
  if (!dasar) return null;
  if (!dipakai.has(dasar)) return dasar;

  for (let suffix = 2; suffix < 50; suffix += 1) {
    const kandidat = internalSkuWithSuffix(input, suffix, supplierSku);
    if (!kandidat) break;
    if (!dipakai.has(kandidat)) return kandidat;
  }

  // 48 akhiran habis tanpa slot bebas - nyaris mustahil, tapi null lebih
  // jujur daripada memasang SKU yang bentrok.
  return null;
}

/**
 * Alias brand untuk game tertentu.
 *
 * Fallback: slug game dengan garis bawah. Panjang, tapi deterministik,
 * unik, dan tidak memakai tanda hubung di dalam bagian brand (tanda
 * hubung adalah pemisah antar bagian SKU).
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
 * Normalisasi label - dipertahankan untuk pencocokan nama.
 *
 * SKU internal TIDAK lagi diturunkan dari sini (lihat
 * `generateInternalSku`), tapi pencocokan produk antar supplier tetap
 * membutuhkannya: dua penulisan berbeda untuk barang yang sama harus
 * jatuh ke kunci perbandingan yang sama.
 */
export function normalizeProductLabel(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .trim()
    .replace(/(?<=\d)\.(?=\d{3}\b)/g, "")
    .replace(/\s+/g, "");
}