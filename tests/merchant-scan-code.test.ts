import assert from "node:assert/strict";
import test from "node:test";

import {
  SCAN_ALPHABET_SIZE,
  formatScanCode,
  generateScanCodeFrom,
  normalizeScanCode,
  SCAN_CODE_LENGTH,
} from "../src/lib/merchant-scan-code.ts";

/**
 * Kode pindai merchant.
 *
 * Yang diuji di sini bukan "fungsi ini benar secara matematis", tapi
 * "apakah kasir sungguhan bisa memakainya". Semua test ini menulis ulang
 * variation yang muncul ketika orang mengetik ke layar sentuh di konter:
 * huruf salah, spasi di tempat aneh, tanda hubung terlewat.
 *
 * Kalau salah satu gagal, kasir melihat "kode tidak ditemukan" untuk order
 * yang sebenarnya ada - dan itu akhir dari alur penjualan.
 */

/**
 * PRNG deterministik yang mengembalikan INDEX ALFABET pada rentang
 * `0..SCAN_ALPHABET_SIZE-1`, sesuai kontrak `generateScanCodeFrom`.
 *
 * xorshift32, bukan LCG. LCG modulo kelipatanDua menghasilkan pola dengan
 * periode pendek - `state % 32` dari LCG hanya menghasilkan 32 kombinasi
 * berbeda. Itu membuat test "kode berbeda satu sama lain" gagal bukan
 * karena kodenya salah, tapi karena PRNG-nya tidak bisa membedakan. Test
 * yang gagal karena alatnya sendiri tidak berguna lebih buruk daripada
 * tidak ada test.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % SCAN_ALPHABET_SIZE;
  };
}

test("indeks di luar rentang tidak menghasilkan kode dari teks 'undefined'", () => {
  /*
   * Bug nyata yang pernah terjadi: pemanggil meng-injek angka desimal
   * [0, 1), lalu fungsi mengalikan sendiri dengan panjang alfabet.
   * Hasilnya indeks sampai 992, setiap akses di luar rentang mengembalikan
   * `undefined`, dan keenam karakter menjadi "UNDEFI" untuk SETIAP order -
   * kode yang tidak bisa dinormalisasi, jadi tidak pernah bisa dipindai.
   *
   * Gejalanya tidak muncul di test lama karena PRNG test ikut salah, jadi
   * keduanya menghasilkan kode yang sama dan dianggap benar.
   */
  const outOfRange = () => 999;
  const code = generateScanCodeFrom(outOfRange);

  assert.match(code, /^MR[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
  assert.equal(normalizeScanCode(code), code);
  assert.ok(!code.includes("undefined"));
});

test("kode yang dihasilkan benar-benar berbeda satu sama lain", () => {
  // Kalau PRNG mengembalikan nilai konstan lagi, semua order dapat kode yang
  // sama - dan unique index di database akan menolak yang kedua.
  const codes = new Set<string>();
  for (let seed = 1; seed <= 50; seed += 1) {
    codes.add(generateScanCodeFrom(seeded(seed)));
  }
  assert.ok(codes.size > 40, "hanya " + codes.size + " kode berbeda dari 50");
});

test("generate selalu menghasilkan kode yang bisa dinormalisasi balik", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const code = generateScanCodeFrom(seeded(seed));
    // Kalau round-trip ini gagal, kode yang tersimpan di database tidak akan
    // pernah bisa diketik kasir.
    assert.equal(
      normalizeScanCode(code),
      code,
      `seed ${seed} menghasilkan kode yang tidak round-trip: ${code}`,
    );
  }
});

test("generate menghasilkan 6 karakter setelah prefix", () => {
  const code = generateScanCodeFrom(seeded(42));
  assert.match(code, /^MR[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
  assert.equal(code.replace("MR", "").replace("-", "").length, SCAN_CODE_LENGTH);
});

test("generate tidak pernah memakai huruf yang sering tertukar", () => {
  /*
   * I, L, O, dan U DIHAPUS dari alfabet. Ini inti dari seluruh modul: kalau
   * salah satu muncul di kode yang tersimpan, kasir akan mengetiknya jadi
   * digit yang salah dan mendapat "kode tidak ditemukan".
   */
  for (let seed = 1; seed <= 300; seed += 1) {
    const code = generateScanCodeFrom(seeded(seed));
    for (const forbidden of ["I", "L", "O", "U"]) {
      assert.ok(
        !code.includes(forbidden),
        `kode ${code} memuat huruf terlarang ${forbidden}`,
      );
    }
  }
});

test("huruf kecil diterima", () => {
  assert.equal(normalizeScanCode("mr7k2x9q"), "MR7K2-X9Q");
  assert.equal(normalizeScanCode("Mr7K2-X9q"), "MR7K2-X9Q");
});

test("spasi di tempat mana pun diterima", () => {
  const expected = "MR7K2-X9Q";
  assert.equal(normalizeScanCode("MR7K 2X9Q"), expected);
  assert.equal(normalizeScanCode("MR7K2-X9Q"), expected);
  assert.equal(normalizeScanCode(" MR 7K 2 X9Q "), expected);
  assert.equal(normalizeScanCode("MR7K2X9Q"), expected);
  assert.equal(normalizeScanCode("mr7k2 x9q"), expected);
});

test("huruf konfusable diganti ke pasangannya", () => {
  /*
   * Body kode yang sah adalah 6 karakter (tanpa prefix). Di sini body-nya
   * `1K2X9Q`, jadi bentuk kanoniknya `MR1K2-X9Q`.
   *
   * Kasir bisa saja membaca digit 1 itu sebagai I atau L, dan nol sebagai
   * O. Semua tiga harus diterima sebagai kode yang sama - kalau tidak,
   * kasir mendapat "kode tidak ditemukan" untuk order yang sedang berdiri
   * di depannya.
   */
  assert.equal(normalizeScanCode("MR1K2-X9Q"), "MR1K2-X9Q");
  assert.equal(normalizeScanCode("MRIK2-X9Q"), "MR1K2-X9Q");
  assert.equal(normalizeScanCode("MRLK2-X9Q"), "MR1K2-X9Q");
  assert.equal(normalizeScanCode("mr1k2 x9q"), "MR1K2-X9Q");

  assert.equal(normalizeScanCode("MR0K2-X9Q"), "MR0K2-X9Q");
  assert.equal(normalizeScanCode("MROK2-X9Q"), "MR0K2-X9Q");
  assert.equal(normalizeScanCode("mr0k2 x9q"), "MR0K2-X9Q");
});

test("input bukan kode ditolak dengan null, bukan error", () => {
  /*
   * Alasan: pemanggil butuh satu cabang kegagalan, bukan dua. Kalau
   * normalize melempar, setiap pemanggil harus try/catch, dan ada tempat
   * yang lupa.
   */
  for (const input of [
    "",
    "   ",
    "XK2-X9Q", // prefix salah
    "MR",
    "MR7K2X9", // terlalu pendek (5 karakter)
    "MR7K2X9QQ", // terlalu panjang (7 karakter)
    "MR7K2-X!", // karakter di luar alfabet
    "!!!",
    "12345678",
  ]) {
    assert.equal(
      normalizeScanCode(input),
      null,
      `harus ditolak: ${JSON.stringify(input)}`,
    );
  }
});

test("huruf terlarang DITOLAK kalau tidak bisa disubstitusi", () => {
  /*
   * `U` punya pasangan di Crockford penuh, tapi di alfabet 32 karakter ini
   * tidak ada pasangannya, jadi `U` harus ditolak. Kalau dibiarkan masuk,
   * kode `MR7K-UXXX` bisa tersimpan tapi tidak pernah bisa diketik.
   */
  assert.equal(normalizeScanCode("MR7K2-UX9Q"), null);
});

test("formatScanCode selalu menghasilkan bentuk kanonik", () => {
  assert.equal(formatScanCode("MR7K2X9Q"), "MR7K2-X9Q");
  assert.equal(formatScanCode("MR000000"), "MR000-000");
});

test("kode yang dinormalisasi idempoten", () => {
  // Kalau ini tidak berlaku, setiap lookup menambahkan tanda hubung baru.
  const once = normalizeScanCode(" mr7k 2x9q ");
  assert.ok(once);
  assert.equal(normalizeScanCode(once), once);
  assert.equal(normalizeScanCode(normalizeScanCode(once)!), once);
});