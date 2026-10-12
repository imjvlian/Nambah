/**
 * Peringkat kandidat Melostore untuk satu produk internal.
 *
 * MODUL MURNI - tanpa I/O. Dipakai combobox di editor katalog: saat
 * operator membuka pemilih SKU untuk produk tertentu, daftar yang muncul
 * BUKAN katalog utuh 9.126 SKU, tapi kandidat yang diperkirakan relevan
 * untuk produk itu - supaya tidak perlu mengetik kalau barang setaranya
 * memang jelas, dan tetap bisa mencari manual kalau tidak.
 *
 * TIGA TINGKAT PERINGKAT
 *
 * 1. COCOK  - nama ternormalisasi sama persis. Inilah yang otomatis
 *    dipasang (kalau tepat satu dan guard prefiks lolos).
 *
 * 2. MENDEKATI - nama berbeda tulis, tapi atribut identitas cocok:
 *    prefiks SKU milik game yang sama DAN nominal sama. Contoh nyata:
 *    "56 Diamond" (Digiflazz) vs "56 Diamonds (Event)" (Melostore).
 *    Nama tidak sama, barangnya sama.
 *
 * 3. SISANYA tidak disarankan sama sekali - operator mengetik manual.
 *    Menyarankan barang dari game lain atau nominal lain hanya akan
 *    mempercepat salah pilih.
 *
 * Setiap kandidat wilayah lain (mlmy/mlgl/...) membawa tanda wilayahnya
 * sendiri, supaya varian Malaysia tidak terpilih diam-diam untuk akun
 * Indonesia.
 */

import {
  expectedPrefixes,
  normalizeLabel,
  skuMulaiDenganPrefiks,
} from "@/lib/suppliers/match";
import { normalizeText } from "@/lib/game-defaults";
import { nominalFromLabel } from "@/lib/internal-sku";


export type KandidatMelostore = {
  sku: string;
  name: string;
  cost: number;
  /** Wilayah tersirat dari prefiks SKU (MY/GL/...), null untuk utama. */
  region: string | null;
  /** true = nama ternormalisasi sama persis dengan produk. */
  exact: boolean;
  /** true = prefiks SKU milik game yang sama. */
  sameGame: boolean;
  /** true = nominal sama dengan produk. */
  sameNominal: boolean;
};

/**
 * Input katalog yang diterima: cukup field ini. Pemanggil dari
 * database tidak punya `stock`/`supplierId` milik SupplierQuote, dan
 * fungsi ini memang hanya menerima katalog Melostore.
 */
export type KandidatSkuMelostore = {
  sku: string;
  name: string;
  cost: number;
  /**
   * Brand asli dari katalog supplier - identitas game untuk SKU yang
   * prefiksnya tidak dikenal (mis. "rgc..." -> "Roblox (IDR)").
   * Opsional supaya pemanggil lama tetap sah.
   */
  brand?: string | null;
};

export type KandidatProduk = {
  gameId: string;
  label: string;
  /** Nama game Nambah - identitas brand untuk game tanpa prefiks. */
  gameName?: string;
  gameShortName?: string;
};

export type KandidatTerperingkat = {
  /** Nama sama persis. Kosong = tidak ada auto-map. */
  tepat: KandidatMelostore[];
  /**
   * Prefiks game dan nominal cocok, tapi nama tidak sama persis.
   * Inilah "pilihan yang mendekati" saat auto-map kosong.
   */
  mendekati: KandidatMelostore[];
};

/**
 * Wilayah dari prefiks SKU Melostore.
 *
 * Duplikat logika region di `internal-sku.ts`? Bukan - yang di sana
 * menghasilkan akhiran SKU internal, ini menandai kandidat di UI. Kalau
 * digabung, perubahan satu akan mengubah dua makna yang berbeda.
 */
function regionKandidat(sku: string): string | null {
  const s = String(sku ?? "").trim().toLowerCase();

  /*
   * Wilayah utama dicek lebih dulu: mlid/ffid/pubgmid adalah Indonesia,
   * pasar utama tanpa akhiran. Tanpa pengecekan ini, "mlidpass-s1"
   * tidak terbaca wilayahnya sama sekali karena ekstraksi huruf rakus.
   */
  if (/^(mlid|ffid|pubgmid)/.test(s)) return null;

  for (const [prefix, region] of Object.entries({
    mlmy: "MY", mlph: "PH", mlbr: "BR", mlus: "US", mlgl: "GL",
    ffmy: "MY", ffbr: "BR", ffg: "GL", pubgmgl: "GL",
  })) {
    if (s.startsWith(prefix)) return region;
  }
  return null;
}

/**
 * Apakah kandidat SKU ini milik game yang sama dengan produk.
 *
 * DUA JALUR IDENTITAS, urut kekuatan:
 *
 * 1. PREFIKS SKU - untuk game yang dikenal daftar prefiksnya
 *    (mobile-legends, free-fire, ...). Jalur ini region-aware: varian
 *    wilayah (mlmy/ffg/...) tetap terbaca sebagai game yang sama dan
 *    ditandai regionnya oleh pemanggil.
 *
 * 2. BRAND - hanya untuk game TANPA prefiks dikenal. Game hasil
 *    "buat otomatis dari brand" (roblox-idr, mongil-star-dive, ...)
 *    tidak punya prefiks sama sekali; satu-satunya identitasnya adalah
 *    nama, dan katalog supplier menyebutnya lewat brand. Perbandingan
 *    STRICT tanpa mengupas tanda kurung: "Free Fire (Global)" tidak
 *    akan pernah menyusup ke game "Free Fire" lewat jalur ini, karena
 *    jalur brand hanya aktif saat game TIDAK punya prefiks.
 */
export function gameCocokUntukProduk(
  produk: KandidatProduk,
  kandidat: { sku: string; brand?: string | null },
): boolean {
  const prefiks = expectedPrefixes(produk.gameId);
  if (prefiks.length > 0) {
    return skuMulaiDenganPrefiks(kandidat.sku, prefiks);
  }

  const brand = String(kandidat.brand ?? "").trim();
  if (!brand) return false;

  const targetBrand = normalizeText(brand);
  for (const nama of [produk.gameName, produk.gameShortName]) {
    if (nama && normalizeText(nama) === targetBrand) return true;
  }
  return false;
}

/**
 * Peringkatkan katalog Melostore untuk satu produk.
 *
 * `quotes` adalah katalog Melostore utuh (7.000-an SKU) - dipindai satu
 * kali per produk. Dipanggil saat combobox dibuka, bukan untuk seluruh
 * halaman, supaya biayanya sekali per keputusan.
 */
export function urutkanKandidatMelostore(
  produk: KandidatProduk,
  quotes: readonly KandidatSkuMelostore[],
): KandidatTerperingkat {
  const target = normalizeLabel(produk.label);
  const nominalProduk = nominalFromLabel(produk.label);

  const tepat: KandidatMelostore[] = [];
  const mendekati: KandidatMelostore[] = [];

  for (const quote of quotes) {
    if (!quote.sku || quote.cost < 0) continue;

    const nama = normalizeLabel(quote.name);
    const samaNama = nama === target;
    const sameGame = gameCocokUntukProduk(produk, quote);
    const nominalItem = nominalFromLabel(quote.name);
    const sameNominal =
      nominalProduk !== null &&
      nominalItem !== null &&
      nominalProduk === nominalItem;

    /*
     * COCOK menuntut DUA bukti: nama sama persis DAN game sama.
     * Nama saja tidak cukup - 57 label identik dipakai lebih dari satu
     * game, dan "50 Diamonds" Free Fire sama persis dengan "50 Diamonds"
     * Mobile Legends. Menampilkan item game salah sebagai COCOK akan
     * mempercepat salah petakan; guard server menolaknya saat disimpan,
     * tapi lebih baik tidak pernah ditawarkan.
     */
    if (!sameGame) continue;

    if (!samaNama && !sameNominal) continue;

    const kandidat: KandidatMelostore = {
      sku: quote.sku,
      name: quote.name,
      cost: quote.cost,
      region: regionKandidat(quote.sku),
      exact: samaNama,
      sameGame,
      sameNominal,
    };

    if (samaNama) tepat.push(kandidat);
    else mendekati.push(kandidat);
  }

  // Termurah dulu di dalam tiap tingkat - keputusan operator selalu
  // melihat harga naik, bukan acak sesuai urutan respons API.
  const murah = (a: KandidatMelostore, b: KandidatMelostore) => a.cost - b.cost;
  tepat.sort(murah);
  mendekati.sort(murah);

  // Maksimal 10 per tingkat: combobox tidak pernah menjadi daftar panjang
  // yang menggulir lebih dari sekali layar.
  return {
    tepat: tepat.slice(0, 10),
    mendekati: mendekati.slice(0, 10),
  };
}

/**
 * Gabungan terurut untuk ditampilkan: tepat dulu, lalu mendekati.
 * Tingkatnya tetap terbawa supaya UI bisa menandai mana yang bukan
 * kecocokan sempurna.
 */
export function gabungkanKandidat(
  terperingkat: KandidatTerperingkat,
): KandidatMelostore[] {
  return [...terperingkat.tepat, ...terperingkat.mendekati];
}