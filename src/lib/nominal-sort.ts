/**
 * Pengurutan nominal paket di halaman pembelian.
 *
 * Aturan:
 * - Item yang punya jumlah mata uang di label ("86 Diamonds", "60 UC",
 *   "1.980 Monochrome") diurutkan dari jumlah kecil ke besar.
 * - Item tanpa jumlah (pass, membership, item khusus) ditaruh setelahnya,
 *   diurutkan dari harga termurah.
 * - Titik diperlakukan sebagai pemisah ribuan gaya Indonesia ("1.980" = 1980),
 *   dan angka pertama yang diambil ("300 + 30 Crystals" = 300).
 */

export type NominalSortable = {
  label: string;
  sellingPrice: number;
};

/**
 * Nominal untuk sorting di halaman pembelian.
 *
 * ATURAN "A + B": jumlah, bukan angka pertama.
 *
 * "40 + 4 Diamonds" harus tampil di posisi 44 (jumlah), bukan 40
 * (angka pertama) - kalau tidak, urutannya salah relatif ke "44
 * Diamonds" yang memang ada di katalog. Melostore memakai jumlah itu
 * di SKU code (mlus44d), dan pembeli berpikir dalam total yang
 * diterima.
 *
 * Tanpa "+": angka pertama (perilaku lama).
 */
export function extractNominalAmount(label: string): number | null {
  const bersih = label.replace(/(?<=\d)\.(?=\d{3}\b)/g, "");

  const plus = bersih.match(/(\d[\d,]*)\s*\+\s*(\d[\d,]*)/);
  if (plus) {
    const a = Number(plus[1]!.replace(/,/g, ""));
    const b = Number(plus[2]!.replace(/,/g, ""));
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return a + b;
    }
  }

  const match = bersih.match(/\d{1,3}(?:\.\d{3})+|\d+/);
  if (!match) return null;
  const value = Number(match[0].replace(/\./g, "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function compareNominalItems<T extends NominalSortable>(a: T, b: T) {
  const amountA = extractNominalAmount(a.label);
  const amountB = extractNominalAmount(b.label);

  if (amountA !== null && amountB !== null && amountA !== amountB) {
    return amountA - amountB;
  }
  if (amountA === null && amountB !== null) return 1;
  if (amountA !== null && amountB === null) return -1;
  if (a.sellingPrice !== b.sellingPrice) return a.sellingPrice - b.sellingPrice;
  return a.label.localeCompare(b.label);
}

export function sortNominalItems<T extends NominalSortable>(items: readonly T[]): T[] {
  return [...items].sort(compareNominalItems);
}

export type NominalSortableWithNote = NominalSortable & {
  note?: string | null;
};

const PASS_LIKE_PATTERN =
  /(weekly diamond pass|twilight pass|starlight|battle pass|booyah pass|elite pass|membership|member|welkin|lunite subscription|weekly card|monthly card|weekly pack|monthly pack|paket mingguan|paket bulanan|\bpass\b)/i;

/** Pass, membership, dan paket langganan — tipe yang harus tampil di atas. */
export function isPassLikeItem(label: string, note?: string | null) {
  return PASS_LIKE_PATTERN.test(`${label} ${note ?? ""}`);
}

/**
 * Komparator untuk daftar katalog (mis. admin): pass/langganan selalu di atas,
 * sisanya mengikuti compareNominalItems (jumlah kecil di atas, lalu harga).
 */
export function compareCatalogItems<T extends NominalSortableWithNote>(a: T, b: T) {
  const passA = isPassLikeItem(a.label, a.note);
  const passB = isPassLikeItem(b.label, b.note);
  if (passA !== passB) return passA ? -1 : 1;
  return compareNominalItems(a, b);
}

export function sortCatalogItems<T extends NominalSortableWithNote>(items: readonly T[]): T[] {
  return [...items].sort(compareCatalogItems);
}
