/**
 * Kode pindai merchant — bagian MURNI, tanpa I/O.
 *
 * Format: `MR7K-2X9Q` — prefix `MR` + 6 karakter, dipisah tanda hubung
 * supaya kasir bisa membacanya keras-keras dan mengetiknya dalam dua bagian.
 *
 * ALFABET CROCKFORD, bukan A-Z0-9. Empat huruf (`I`, `L`, `O`, `U`)
 * sengaja dibuang karena itu huruf yang paling sering tertukar saat dibaca
 * atau diketik manusia:
 *
 *   1  <-> I dan L        (satu, eye, satu, el)
 *   0  <-> O             (nol, oh)
 *   5  <-> S             (lima, es)
 *
 * Satu karakter tertukar berarti kasir mengira ordernya tidak ada padahal
 * ada. Menghapus huruf yang ambigu dari sumbernya jauh lebih murah daripada
  * tangani error di layar kasir.
 *
 * Modul ini sengaja tidak mengimpor apa pun: bisa dipakai dari route server,
 * komponen client, dan test runner tanpa menarik dependensi.
 */

/**
 * Alfabet Crockford yang sudah dipangkas.
 *
 * Crockford penuh juga memetakan `U`/`O` ke nama panjang, tapi untuk kode
 * 6 karakter kita butuh hanya 32 simbol. Alfabet ini sudah menyediakan 32
 * dan hanya menyisakan `0-9` dan huruf tanpa I/L/O/U.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Jumlah karakter setelah prefix. */
export const SCAN_CODE_LENGTH = 6;

/** Prefix yang memulai semua kode pindai merchant. */
export const SCAN_CODE_PREFIX = "MR";

/**
 * Substitusi toleran untuk huruf yang sering tertukar.
 *
 * Berlaku HANYA di input manusia (ketikan kasir), tidak pernah di output.
 * Generate selalu memakai `ALPHABET` apa adanya, jadi kode yang tersimpan
 * sudah bebas dari ambiguitas sejak awal.
 */
const CONFUSABLE_SUBSTITUTIONS: Record<string, string> = {
  I: "1",
  L: "1",
  O: "0",
};

/**
 * Bentuk kanonik: `MR7K-2X9Q`.
 *
 * Toleran terhadap masukannya juga: prefix boleh sudah ada atau belum, dan
 * spasi/tanda hubung boleh di mana pun. Idempoten - memformat kode yang
 * sudah kanonik menghasilkan kode yang sama persis.
 */
export function formatScanCode(raw: string): string {
  const stripped = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  const body = stripped.startsWith(SCAN_CODE_PREFIX)
    ? stripped.slice(SCAN_CODE_PREFIX.length)
    : stripped;

  // Posisi tanda hubung ditentukan dari PANGKAAN kode, bukan dari posisi di
  // string input. Kalau dihitung dari input, kode yang sudah punya prefix
  // akan terpotong di tempat yang salah - `MR7K2X9Q` jadi `MR7K2-X9Q`.
  const half = SCAN_CODE_LENGTH >> 1;
  const separator = SCAN_CODE_PREFIX.length + half;

  return (
    stripped.slice(0, separator) + "-" + stripped.slice(separator, SCAN_CODE_LENGTH + SCAN_CODE_PREFIX.length)
  );
}

/**
 * Normalisasi input kasir menjadi bentuk kanonik.
 *
 * Menerima setiap variation yang mungkin terjadi di layar sentuh:
 * huruf besar/kecil, spasi, tanda hubung, dan substitusi huruf konfusable.
 * Semua dianggap kode yang sama.
 *
 * Mengembalikan `null` kalau input-nya tidak mungkin jadi kode — bukan
 * melempar error, karena pemanggil butuh satu cabang kegagalan, bukan dua.
 */
export function normalizeScanCode(input: string): string | null {
  const cleaned = input
    .trim()
    .toUpperCase()
    // Spasi dan tanda hubung dibuang di mana pun, bukan cuma di tempat yang
    // diharapkan. Kasir mengetik `MR7K 2X9Q`, `mr7k-2x9q`, atau
    // `MR 7K - 2X9Q` - semuanya harus diterima.
    .replace(/[\s-]/g, "")
    .replace(/[^A-Z0-9]/g, "");

  if (!cleaned.startsWith(SCAN_CODE_PREFIX)) return null;

  const body = cleaned.slice(SCAN_CODE_PREFIX.length);
  if (body.length !== SCAN_CODE_LENGTH) return null;

  let normalized = "";
  for (const char of body) {
    const substituted = CONFUSABLE_SUBSTITUTIONS[char] ?? char;
    if (!ALPHABET.includes(substituted)) return null;
    normalized += substituted;
  }

  return formatScanCode(SCAN_CODE_PREFIX + normalized);
}

/**
 * Generate kode acak yang valid.
 *
 * `randomIndex` WAJIB mengembalikan integer pada rentang
 * `0 .. ALPHABET.length - 1`. Kontrak ini sengaja expressed sebagai INDEX,
 * bukan sebagai angka desimal pada rentang `[0, 1)`.
 *
 * Alasannya, dan ini bukan gaya penulisan: versi sebelumnya menerima
 * desimal `[0, 1)` lalu mengalikan sendiri dengan panjang alfabet. Karena
  * rentangnya begitu dekat dengan rentang index, keduanya sangat mirip dan mudah
 * tertukar - dan ketika tertukar, hasilnya bukan kode yang salah satu
 * karakter, tapi `"MRUND-EFI"` untuk SELURUH order, karena setiap indeks di
 * luar rentang menghasilkan `undefined` yang dirangkai jadi teks `"undefined"`.
 * Kode seperti itu tidak pernah bisa dinormalisasi, jadi tidak pernah bisa
 * dipindai - dan gejalanya baru terlihat saat kasir mengetik.
 *
 * Panjang alfabet diekspor supaya caller tidak perlu menghitung ulang.
 */
export const SCAN_ALPHABET_SIZE = ALPHABET.length;

export function generateScanCodeFrom(randomIndex: () => number): string {
  let body = "";
  for (let i = 0; i < SCAN_CODE_LENGTH; i += 1) {
    const raw = Math.trunc(randomIndex());
    /*
     * Jaga rentang. Nilai di luar rentang adalah bug di pemanggil, dan
     * lebih baik menghasilkan indeks yang bisa dipakai daripada merangkai
     * "undefined" menjadi kode yang tersimpan di database.
     */
    const index =
      Number.isFinite(raw) && raw >= 0 && raw < ALPHABET.length ? raw : 0;
    body += ALPHABET[index];
  }
  return formatScanCode(SCAN_CODE_PREFIX + body);
}