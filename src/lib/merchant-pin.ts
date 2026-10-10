import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash PIN kasir merchant — bagian MURNI, tanpa I/O.
 *
 * Dipisah dari `merchant-auth.ts` karena modul itu mengimpor `server-only`
 * dan Supabase. Fungsi di sini tidak butuh database sama sekali, dan
 * memverifikasi PIN adalah tempat salah satu kelemahan paling mahal kalau
 * gagal: satu tebakan keliru membiarkan siapa pun memindai pesanan orang
 * lain.
 *
 * Format: `scrypt$N$r$p$salt$hash`, semua base64url.
 *
 * Menyimpan parameter algoritma DI DALAM string yang disimpan itu disengaja.
 * Kalau nanti `N` dinaikkan, hash lama masih bisa diverifikasi karena
 * verify membaca parameter dari string-nya sendiri — tidak perlu reset PIN
 * seluruh merchant.
 */

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

/** Batas parameter yang diterima saat verify. */
const MIN_N = 1024;
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

/**
 * Generate PIN acak 6 digit, hanya untuk dicetak admin saat membuat toko.
 *
 * Rentang 100000-999999 supaya PIN tidak pernah diawali `0` — PIN yang
 * tercetak di kertas dan dibaca kasir akan kehilangan nol di depannya kalau
 * dimulai dari angka 0.
 */
export function generateMerchantPin(): string {
  return String(100_000 + (randomBytes(4).readUInt32BE(0) % 900_000));
}

export function hashMerchantPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function verifyMerchantPin(pin: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  /*
   * Tolak parameter di luar batas.
   *
   * Nilai ini berasal dari database, bukan dari pengguna — tapi `scryptSync`
   * akan menghabiskan memori sebanyak N*r kalau menerima angka
   * ganjil, dan itu cukup satu request untuk menjatuhkan proses. Batas ini
   * juga menjaga agar verify tidak diam-diam menerima hash yang sengaja
   * dibuat lemah.
   */
  if (n < MIN_N || n > MAX_N || r < 1 || r > MAX_R || p < 1 || p > MAX_P) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(pin, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}