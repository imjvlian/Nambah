import { randomInt } from "node:crypto";

/**
 * Pembuatan kode affiliate.
 *
 * Logika ini sebelumnya menyatu di dalam `POST /api/admin/affiliates`. Dipindah ke sini
 * supaya approve request memakai aturan yang PERSIS sama dengan pembuatan manual
 * — kalau tidak, kode yang hasil approve bisa berbeda bentuknya dari kode yang
 * dibuat admin, dan pola dua-duanya harus dijaga terpisah.
 */

export const AFFILIATE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

/** Bersihkan input jadi bentuk yang boleh: huruf besar, angka, `-`, `_`. */
export function normalizeAffiliateCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "")
    .slice(0, 40);
}

/**
 * Basis kode dari nama tampilan.
 *
 * Mengembalikan string kosong kalau nama-nya tidak menghasilkan apa pun yang
 * bisa dipakai — pemanggil harus minta kode manual, bukan diam-diam memakai
 * kode kosong.
 */
export function codeBaseFromDisplayName(displayName: string): string {
  const base = normalizeAffiliateCode(displayName.replace(/[^A-Za-z0-9]+/g, ""));
  return base.length >= 3 ? base.slice(0, 12) : "";
}

function randomSuffix() {
  // Huruf dan angka tanpa karakter yang mudah tertukar (0/O, 1/I/L). Kode dibaca
  // orang dan diketik manual, jadi `0` vs `O` yang tertukar berarti affiliate
  // tidak bisa masuk.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/**
 * Kode affiliate yang siap dipakai.
 *
 * `isTaken` wajib dipakai untuk memeriksa kandidat sebelum dikembalikan —
 * guessing tanpa cek akan menghasilkan kode bentrok yang baru ketahuan saat
 * order pertama affiliate itu masuk.
 */
export async function generateAffiliateCode(
  displayName: string,
  isTaken: (code: string) => Promise<boolean>,
): Promise<string | null> {
  const base = codeBaseFromDisplayName(displayName);
  if (!base) return null;

  if (!(await isTaken(base))) return base;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = normalizeAffiliateCode(`${base.slice(0, 28)}_${randomSuffix()}`);
    if (!(await isTaken(candidate))) return candidate;
  }
  return null;
}
