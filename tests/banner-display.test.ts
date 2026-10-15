import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanPopupMessage,
  imageAspectRatio,
  sanitizeExternalUrl,
  usableDimensions,
} from "../src/lib/banner-display.ts";

/**
 * Aturan tampilan banner dan pesan popup.
 *
 * Dua hal yang dijaga, keduanya tidak terlihat benar saat salah:
 *
 * KESALAHAN RASIO. Popup pernah memotong gambar karena tidak tahu ukuran
 * aslinya. Kotaknya dipaksat rasio tetap lalu `cover` dipakai - dan hasilnya
 * "cukup bagus" sampai ada yang mengeluh. Jadi setiap nilai yang tidak
 * masuk akal harus menghasilkan `null`, bukan angka yang mungkin benar.
 *
 * KESALAHAN URL. `cta_href` dirender sebagai `href`. Nilai yang lolos tanpa
 * cek akan jadi tautan yang menjalankan `javascript:` di beranda orang yang
 * membuka promo - jadi penolakan di sini bukan sekadar kerapian.
 */

test("rasio dari banner 1200x400 persis 3", () => {
  assert.equal(imageAspectRatio(1200, 400), 3);
});

test("rasio dari banner potret 1080x1350 persis 0.8", () => {
  assert.equal(imageAspectRatio(1080, 1350), 0.8);
});

test("rasio dari angka string tetap dihitung", () => {
  // Postgres mengirim integer sebagai angka, tapi JSON dari API lain bisa
  // string. Menolak string akan membuat gambar lama kehilangan dimensinya.
  assert.equal(imageAspectRatio("1200", "400"), 3);
});

test("dimensi tidak masuk akal menghasilkan null, bukan angka(parseFloat) yang mungkin", () => {
  const tidakMasukAkal: Array<[unknown, unknown]> = [
    [0, 400],
    [1200, 0],
    [-1200, 400],
    [1200, -400],
    [NaN, 400],
    [1200, NaN],
    [null, null],
    [undefined, undefined],
    ["", ""],
    ["bukan angka", 400],
    [Infinity, 400],
  ];

  for (const [width, height] of tidakMasukAkal) {
    assert.equal(
      imageAspectRatio(width as number, height as number),
      null,
      `harus null: ${String(width)}x${String(height)}`,
    );
  }
});

test("rasio dari dimensi rusak tidak membuat popup melompat tanpa batas", () => {
  /*
   * Rasio 0 membuat `aspect-ratio: 0` yang diabaikan browser, jadi kotak
   * popup kehilangan semua petunjuk tinggi. Angka sebesar ini hanya bisa
   * datang dari data yang rusak, jadi ditolak.
   */
  assert.equal(imageAspectRatio(1, 0), null);
  assert.equal(imageAspectRatio(1, 0.0001), 1e4, "rasio sangat tinggi masih dihitung");
  assert.equal(imageAspectRatio(999999, 999999), null, "melebihi batas realistis");
});

test("usableDimensions membulatkan, ratio tidak", () => {
  const dims = usableDimensions("1200.4", "400.6");

  assert.deepEqual(dims, { width: 1200, height: 401 });
  // Rasio memakai angka mentah supaya tidak ikut terbulatkan dua kali.
  assert.ok(Math.abs((imageAspectRatio(1200.4, 400.6) ?? 0) - 1200.4 / 400.6) < 1e-9);
});

test("usableDimensions null kalau tidak bisa dipakai", () => {
  assert.equal(usableDimensions(null, null), null);
  assert.equal(usableDimensions(0, 100), null);
  assert.equal(usableDimensions(100, 0), null);
});

test("https dan http boleh", () => {
  assert.equal(
    sanitizeExternalUrl("https://promo.example.com/diskon"),
    "https://promo.example.com/diskon",
  );
  assert.equal(
    sanitizeExternalUrl("http://localhost:3000/promo"),
    "http://localhost:3000/promo",
  );
});

test("javascript: DITOLAK - ini yang membuat ini test keamanan", () => {
  /*
   * Nilai ini akan jadi `href` di beranda. Kalau lolos, klik link popup
   * menjalankan skrip di origin situs - sesi, cookie, semuanya.
   */
  const berbahaya = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ];

  for (const url of berbahaya) {
    assert.equal(sanitizeExternalUrl(url), "", `harus ditolak: ${url}`);
  }
});

test("URL relatif ditolak - popup tidak punya konteks halaman", () => {
  // `/promo` berarti relatif terhadap beranda, dan tidak ada di sana.
  assert.equal(sanitizeExternalUrl("/promo"), "");
  assert.equal(sanitizeExternalUrl("//evil.example.com"), "");
});

test("URL kosong dan rusak ditolak tanpa melempar", () => {
  for (const value of ["", "   ", "http://", "https://", "bukan url", null, undefined]) {
    assert.equal(sanitizeExternalUrl(value), "", JSON.stringify(value));
  }
});

test("URL kepanjangan ditolak sebelum di-parse", () => {
  const panjang = "https://example.com/" + "a".repeat(400);
  assert.equal(sanitizeExternalUrl(panjang), "");
});

test("URL yang diparse dinormalisasi, bukan diteruskan mentah", () => {
  // `new URL` menambahkan garis miring terakhir. Yang dikembalikan adalah
  // hasil parse, supaya yang dirender sama persis dengan yang divalidasi.
  assert.equal(sanitizeExternalUrl("https://example.com"), "https://example.com/");
});

test("pesan popup kosong menjadi null, bukan string kosong", () => {
  // `null` membuat popup menyembunyikan badan pesan sepenuhnya. String
  // kosong akan menghasilkan kotak kosong yang tidak melakukan apa-apa.
  assert.equal(cleanPopupMessage(""), null);
  assert.equal(cleanPopupMessage("   "), null);
  assert.equal(cleanPopupMessage(null), null);
  assert.equal(cleanPopupMessage(undefined), null);
});

test("pesan popup dipotong pada batasnya", () => {
  const panjang = "a".repeat(900);

  assert.equal((cleanPopupMessage(panjang) ?? "").length, 500);
  assert.equal(cleanPopupMessage("a".repeat(100))?.length, 100);
  assert.equal(cleanPopupMessage("  halo  "), "halo");
});

test("batas pesan popup bisa diubah tanpa mengubah pemanggil", () => {
  assert.equal((cleanPopupMessage("a".repeat(50), 20) ?? "").length, 20);
});