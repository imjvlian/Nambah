import type { SupplierQuote } from "@/lib/suppliers/types";

/**
 * Pencocokan SKU supplier ke produk Nambah.
 *
 * MODUL MURNI - tanpa I/O, tanpa database. Semua keputusan diambil dari
 * argumen, dan setiap keputusan bisa diuji tanpa server.
 *
 * MASALAH YANG DISELESAIKAN
 *
 * Semua produk Nambah berasal dari sinkronisasi Digiflazz: id-nya
 * `df-<sku digiflazz>-<hash>`, dan labelnya seperti "50 Diamonds".meaning
 * Melostore menyebut produk yang sama dengan nama berbeda: "50 Diamonds"
 * juga ada di Melostore, tapi SKU-nya `ffg50dd-s4` (global) dan
 * `ffid50d-s7` (Indonesia).
 *
 * Yang lebih berbahaya: 57 label IDENTIK dipakai lebih dari satu produk.
 * "10.000" ada di Telkomsel, Indosat, Smartfren, Axis, dan By.u.
 * Pencocokan berbasis nama akan memetakan pulsa Telkomsel ke SKU By.u -
 * dan pembelinya menerima top up operator yang salah.
 *
 * ATURAN KETAT: BUKTI, BUKAN TEBAKAN
 *
 * Sebuah pasangan hanya dibuat kalau DUANYA cocok - nama produk DAN
 * prefiks supplier. Kalau hanya salah satu, hasilnya disimpan sebagai
 * kandidat dengan alasan yang bisa dibaca orang, bukan dipasang diam-diam.
 */

export type MatchConfidence = "exact" | "ambiguous" | "none";

export type MatchReason =
  | "matched"
  | "label-not-found"
  | "label-shared-by-multiple-products"
  | "no-candidate-supplier"
  | "multiple-supplier-sku"
  | "game-not-allowed";

export type MatchOutcome = {
  productId: string;
  label: string;
  supplierId: string;
  /** SKU yang dipilih, atau `null` kalau belum bisa dipastikan. */
  supplierSku: string | null;
  supplierCost: number | null;
  confidence: MatchConfidence;
  reason: MatchReason;
  /** Alternatif yang dipertimbangkan, untuk ditampilkan di panel admin. */
  candidates: Array<{ sku: string; cost: number }>;
  /** Produk lain yang memakai label sama - inilah sumber ambiguitas. */
  conflictingProductIds: string[];
};

export type MatchableProduct = {
  id: string;
  label: string;
  gameId: string;
};

/**
 * Game yang boleh punya supplier kedua.
 *
 * Produk pulsa dan e-wallet dikecualikan dengan sengaja. Denominasi
 * pulsa antar operator identik ("10.000" ada di lima operator), dan
 * Melostore Armour punya SKU pulsa dengan struktur yang berbeda. Pilot
 * yang benar adalah game, di mana label dan prefiks SKU sama-sama punya
 * informasi yang cukup.
 */
const GAME_ALLOWLIST = new Set([
  "mobile-legends",
  "free-fire",
  "free-fire-max",
  "pubg-mobile",
  "valorant",
  "genshin-impact",
  "honor-of-kings",
]);

/**
 * Normalisasi label jadi kunci perbandingan.
 *
 * Menyatukan variasinya penulisan yang jelas sama: "50 Diamonds",
 * "50 diamonds", "50 Diamond". Dan membuang spasi berlebih yang datang
 * dari katalog supplier.
 *
 * TIDAK menyatukan yang berbeda arti. "1.200" dan "1200" disamakan -
 * keduanya seribu dua ratus - tapi "1.200" dan "1,200" TIDAK, karena
 * yang kedua bisa berarti satu koma dua ratus di locale lain.
 */
export function normalizeLabel(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .trim()
    // "diamonds" dan "diamond" -> "d"
    .replace(/\bdiamonds?\b/g, "d")
    // poin berdesimal: "1.200" -> "1200" (pisah ribuan gaya Indonesia)
    .replace(/(?<=\d)\.(?=\d{3}\b)/g, "")
    .replace(/\s+/g, "");
}

/**
 * Ekstrak prefiks supplier dari SKU.
 *
 * Melostore memakai awalan game yang bisa dibaca: `mlid` (ML Indonesia),
 * `mlgl` (ML global), `ffid` (FF Indonesia), `ffg` (FF global), `hok`,
 * `pubg`, `zep`, `val`.
 *
 * Fungsi ini mengembalikan awalan yang DINormalisasi supaya perbandingan
 * dengan awalan yang diharapkan tidak postural karena perbedaan kapital.
 */
export function supplierPrefix(sku: string): string | null {
  const m = /^([a-z]+)/i.exec(String(sku ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Awalan SKU Melostore untuk game Nambah.
 *
 * Dipakai sebagai penyaring: SKU yang prefiksnya tidak ada di daftar ini
 * tidak mungkin milik game tersebut, berapa pun cocoknya nama.
 *
 * Mengembalikan array karena satu game punya beberapa wilayah -
 * `mlid` dan `mlgl` sama-sama Mobile Legends.
 */
/**
 * Apakah SKU diawali salah satu prefiks yang diketahui.
 *
 * JANGAN mengekstrak prefiks dengan `^[a-z]+` lalu membandingkannya:
 * ekstraksi itu rakus - "mlidpass-s1" (Weekly Pass, tanpa angka) akan
 * terbaca berprefiks "mlidpass", yang tidak ada di daftar game mana
 * pun, dan produk Weekly Pass selalu terlihat "tidak ada kandidat".
 * Pencocokan startsWith terhadap daftar yang diketahui tidak punya
 * kelemahan itu, karena "mlidpass-s1" jelas diawali "mlid".
 */
export function skuMulaiDenganPrefiks(sku: string, prefiks: readonly string[]): boolean {
  const s = String(sku ?? "").trim().toLowerCase();
  return prefiks.some((prefix) => s.startsWith(prefix.toLowerCase()));
}

export function expectedPrefixes(gameId: string): string[] {
  switch (gameId) {
    case "mobile-legends":
      return ["mlid", "mlmy", "mlph", "mlbr", "mlgl", "mlus"];
    case "free-fire":
      return ["ff", "ffid", "ffg"];
    case "free-fire-max":
      return ["ff", "ffid", "ffg"];
    case "pubg-mobile":
      return ["pubg", "pubgm", "pubgmgl", "pubgmi"];
    case "valorant":
      return ["val", "valorant"];
    case "genshin-impact":
      return ["genshin", "ys", "gi"];
    case "honor-of-kings":
      return ["hok", "hoking", "hokglobal"];
    default:
      return [];
  }
}

/**
 * Game Nambah dari prefiks SKU Melostore (peta balik `expectedPrefixes`).
 *
 * Digunakan oleh:
 * - `merge-internal-sku`: turunkan SKU internal dari sisi Melostore
 * - Browser katalog Melostore: kelompokkan per game di server
 *
 * Mengembalikan `{ gameId, confident }`:
 * - `confident: true`  → prefiks unik untuk satu game (mlid, hok, pubgm, val, dll)
 * - `confident: false` → prefiks ambigu (ff → free-fire ATAU free-fire-max)
 * - `gameId: ""`       → prefiks tidak dikenal
 */
export function gameDariPrefiksSku(sku: string): { gameId: string; confident: boolean } {
  const s = String(sku ?? "").trim().toLowerCase();

  // Urutan penting: cek prefiks panjang dulu supaya "pubgmgl" tidak terbaca "pubg"
  const daftar: Array<{ prefixes: string[]; gameId: string; confident: boolean }> = [
    { prefixes: ["mlid", "mlmy", "mlph", "mlbr", "mlgl", "mlus"], gameId: "mobile-legends", confident: true },
    { prefixes: ["hok", "hoking", "hokglobal"], gameId: "honor-of-kings", confident: true },
    { prefixes: ["pubgmgl", "pubgmi"], gameId: "pubg-mobile", confident: true },
    { prefixes: ["pubg", "pubgm"], gameId: "pubg-mobile", confident: true },
    { prefixes: ["val", "valorant"], gameId: "valorant", confident: true },
    { prefixes: ["zep"], gameId: "zepeto", confident: true },
    { prefixes: ["aov"], gameId: "arena-of-valor", confident: true },
    { prefixes: ["cod"], gameId: "call-of-duty-mobile", confident: true },
    { prefixes: ["genshin", "ys", "gi"], gameId: "genshin-impact", confident: true },
    // ff/ffid/ffg dipakai free-fire DAN free-fire-max → ambigu
    { prefixes: ["ff", "ffid", "ffg"], gameId: "free-fire", confident: false },
  ];

  for (const { prefixes, gameId, confident } of daftar) {
    if (prefixes.some((p) => s.startsWith(p))) return { gameId, confident };
  }
  return { gameId: "", confident: false };
}

/**
 * Apakah game ini boleh punya supplier kedua.
 *
 * Dipisah dari `expectedPrefixes` supaya alasan produk ini tidak
 * mencoba dipetakan bisa ditampilkan ke operator, bukan sekadar
 * "tidak ada SKU yang cocok".
 */
export function isGameEligible(gameId: string): boolean {
  return GAME_ALLOWLIST.has(gameId);
}

/**
 * Quote yang sudah membawa nama produk dari katalog supplier.
 *
 * `SupplierQuote` sengaja TIDAK punya kolom nama: selection tidak
 * membutuhkannya, dan menambahkannya berarti setiap adapter harus
 * mengambil data yang belum tentu ada. PencocokanQIbutuhkannya - jadi
 * label ditempelkan di sini, dari katalog lengkap yang sudah ada di memory.
 */
export type LabeledQuote = SupplierQuote & { skuLabel?: string };

export function withSkuLabels(
  quotes: readonly SupplierQuote[],
  labels: ReadonlyMap<string, string>,
): LabeledQuote[] {
  return quotes.map((q) => ({
    ...q,
    skuLabel: labels.get(q.sku),
  }));
}
/**
 * Cari SKU Melostore untuk satu produk.
 *
 * Alur: label produk disaring lebih dulu, lalu kandidat SKU disaring lagi
 * berdasarkan prefiks game. Hanya SKU yang lolos KEDUA filter yang
 * dipertimbangkan.
 *
 * KUNCINYA: kalau lebih dari satu SKU lolos, hasilnya `ambiguous`, bukan
 * "ambil yang pertama". Melostore punya SKU regional dengan nama sama
 * ("50 Diamonds" di Indonesia dan global, dengan harga berbeda) -
 * memilih salah satu tanpa dasar berarti mengirim top up ke wilayah yang
 * salah, dan itu tidak bisa dibatalkan setelah sampai ke supplier.
 */
export function matchProductToSupplier(
  product: MatchableProduct,
  quotes: readonly LabeledQuote[],
  options: {
    /** Batasi ke satu supplier. Default: `melostore`. */
    supplierId?: string;
    /** Produk lain dengan label sama - sumber ambiguitas. */
    productsWithSameLabel?: readonly MatchableProduct[];
  } = {},
): MatchOutcome {
  const supplierId = options.supplierId ?? "melostore";
  const target = normalizeLabel(product.label);

  const conflicts = (options.productsWithSameLabel ?? [])
    .filter(
      (p) =>
        p.id !== product.id &&
        normalizeLabel(p.label) === target,
    )
    .map((p) => p.id);

  const kosong: MatchOutcome = {
    productId: product.id,
    label: product.label,
    supplierId,
    supplierSku: null,
    supplierCost: null,
    confidence: "none",
    reason: "matched",
    candidates: [],
    conflictingProductIds: conflicts,
  };

  if (!isGameEligible(product.gameId)) {
    return { ...kosong, reason: "game-not-allowed" };
  }

  const prefiks = expectedPrefixes(product.gameId);
  if (prefiks.length === 0) {
    return { ...kosong, reason: "game-not-allowed" };
  }

  const bySupplier = quotes.filter((q) => q.supplierId === supplierId);
  if (bySupplier.length === 0) {
    return { ...kosong, reason: "no-candidate-supplier" };
  }

  /*
   * Saring berdasarkan label LEBIH LEBAR dulu, sebelum prefiks.
   *
   * Sifat kandidat dipakai untuk pesan "kenapa tidak cocok". Kalau
   * prefiks disaring lebih dulu, produk dengan prefiks salah akan
   * terlihat seperti "labelnya tidak ada di supplier" - padahal
   * labelnya ada, cuma milik game lain.
   */
  const byLabel = bySupplier.filter(
    (q) => normalizeLabel(q.skuLabel ?? "") === target,
  );

  if (byLabel.length === 0) {
    /*
     * Bentuk longgar: label Melostore kadang punya keterangan tambahan
     * ("28 Diamonds (Malaysia)") yang tidak ada di Nambah. Stringnya
     * tidak sama persis, tapi isinya sama - itu tetap layak dicatat
     * sebagai kandidat supaya operator punya titik awal.
     */
    const longgar = bySupplier.filter((q) =>
      normalizeLabel(q.skuLabel ?? "").startsWith(target),
    );
    return {
      ...kosong,
      reason: "label-not-found",
      candidates: longgar
        .map((q) => ({ sku: q.sku, cost: q.cost }))
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 5),
    };
  }

  const narrowed = byLabel.filter((q) => skuMulaiDenganPrefiks(q.sku, prefiks));

  if (narrowed.length === 0) {
    return {
      ...kosong,
      reason: "no-candidate-supplier",
      candidates: byLabel
        .map((q) => ({ sku: q.sku, cost: q.cost }))
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 5),
    };
  }

  if (narrowed.length > 1) {
    /*
     * Lebih dari satu SKU lolos. TIDAK ada yang dipilih.
     *
     * Memilih yang termurah di sini terlihat optimizes, tapi hasilnya
     * order masuk ke wilayah yang tidak diminta - dan itu tidak bisa
     * ditarik kembali.
     */
    return {
      ...kosong,
      confidence: "ambiguous",
      reason: "multiple-supplier-sku",
      candidates: narrowed
        .map((q) => ({ sku: q.sku, cost: q.cost }))
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 5),
    };
  }

  return {
    productId: product.id,
    label: product.label,
    supplierId,
    supplierSku: narrowed[0].sku,
    supplierCost: narrowed[0].cost,
    confidence: "exact",
    reason: "matched",
    candidates: [{ sku: narrowed[0].sku, cost: narrowed[0].cost }],
    conflictingProductIds: conflicts,
  };
}