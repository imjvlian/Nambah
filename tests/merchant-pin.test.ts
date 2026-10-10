import assert from "node:assert/strict";
import test from "node:test";

import {
  generateMerchantPin,
  hashMerchantPin,
  verifyMerchantPin,
} from "../src/lib/merchant-pin.ts";

/**
 * Hash PIN kasir.
 *
 * Modul aslinya mengimpor `server-only` dan Supabase, jadi yang diuji di sini
 * adalah fungsi hash-nya secara langsung - modul ini tidak butuh database
 * sama sekali, dan memverifikasi PIN adalah tempat salah satu kelemahan
 * paling mahal ditemukan kalau gagal: satu tebakan keliru membiarkan siapa pun
 * memindai pesanan orang lain.
 */

test("PIN yang benar selalu diterima", () => {
  const stored = hashMerchantPin("482913");
  assert.equal(verifyMerchantPin("482913", stored), true);
});

test("PIN yang salah ditolak", () => {
  const stored = hashMerchantPin("482913");
  assert.equal(verifyMerchantPin("482914", stored), false);
  // PIN sebelas digit yang menambahkan satu nol harus tetap ditolak.
  assert.equal(verifyMerchantPin("0482913", stored), false);
  assert.equal(verifyMerchantPin("", stored), false);
});

test("PIN sama menghasilkan hash berbeda, dan keduanya tetap valid", () => {
  const a = hashMerchantPin("111111");
  const b = hashMerchantPin("111111");

  // Salt acak. Kalau hash-nya identik, database yang bocor langsung
  // memberi tahu PIN mana yang dipakai bersama oleh banyak merchant.
  assert.notEqual(a, b);
  assert.equal(verifyMerchantPin("111111", a), true);
  assert.equal(verifyMerchantPin("111111", b), true);
});

test("format hash menyimpan parameter algoritma", () => {
  const parts = hashMerchantPin("123456").split("$");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
  // Parameter harus terbaca sebagai angka, bukan teks, supaya verify
  // tidak diam-diam memakai default yang lebih lemah.
  assert.equal(Number.isInteger(Number(parts[1])), true);
  assert.ok(Number(parts[1]) >= 16_384, "N minimal 16384");
});

test("hash rusak ditolak tanpa melempar error", () => {
  /*
   * Nilai ini berasal dari database, jadi bisa saja rusak atau ditulis
   * manual oleh admin. Melempar error di sini akan mengembalikan 500 ke
   * kasir dan membiarkan penyerang memeriksa format satu per satu.
   */
  for (const broken of [
    "",
    "bukan-hash",
    "scrypt$16384$8$1$abc",           // terlalu sedikit bagian
    "scrypt$a$b$c$def$ghi",           // parameter bukan angka
    "argon2$16384$8$1$def$ghi",       // algoritma lain
    "scrypt$999$8$1$def$ghi",         // N terlalu kecil
    "scrypt$99999999$8$1$def$ghi",    // N terlalu besar, akan meledak di memori
    "scrypt$16384$999$1$def$ghi",     // r di luar batas
    "scrypt$16384$8$999$def$ghi",     // p di luar batas
    "scrypt$16384$8$1$$",             // hash kosong
  ]) {
    assert.equal(
      verifyMerchantPin("123456", broken),
      false,
      `harus ditolak: ${JSON.stringify(broken)}`,
    );
  }
});

test("PIN hasil generate selalu 6 digit dan tidak diawali nol", () => {
  for (let i = 0; i < 200; i += 1) {
    const pin = generateMerchantPin();
    assert.match(pin, /^[1-9][0-9]{5}$/);
  }
});

test("PIN generate yang berbeda bisa dipakai untuk hashing", () => {
  const pin = generateMerchantPin();
  assert.equal(verifyMerchantPin(pin, hashMerchantPin(pin)), true);
});