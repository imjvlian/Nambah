import assert from "node:assert/strict";
import test from "node:test";

import { readImageDimensions } from "../src/lib/image-dimensions.ts";

/**
 * Pembaca dimensi gambar dari byte mentah.
 *
 * Fungsi ini dipakai skrip backfill untuk banner yang diunggah sebelum
 * migration 051, jadi belum punya dimensi tersimpan.
 *
 * Yang dijaga di sini adalah dua arah: angka yang benar harus terbaca,
 * dan data rusak harus menghasilkan `null` - BUKAN angka yang mungkin.
 * Dua yang terakhir itu yang berbahaya, karena popup tidak punya cara
 * menceritakan kalau rasionya keliru.
 */

function png(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // panjang chunk IHDR
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number) {
  // SOI, APP0 pendek, lalu SOF0
  const bytes = new Uint8Array(30);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xe0], 2);
  new DataView(bytes.buffer).setUint16(4, 16);
  bytes.set([0xff, 0xc0], 20);
  new DataView(bytes.buffer).setUint16(22, 17);
  bytes[24] = 8; // presisi
  new DataView(bytes.buffer).setUint16(25, height);
  new DataView(bytes.buffer).setUint16(27, width);
  return bytes;
}

function webpX(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  bytes[20] = 0x10;
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >> 8) & 0xff;
  bytes[26] = ((width - 1) >> 16) & 0xff;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >> 8) & 0xff;
  bytes[29] = ((height - 1) >> 16) & 0xff;
  return bytes;
}

function webpLossy(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  new DataView(bytes.buffer).setUint16(26, width);
  new DataView(bytes.buffer).setUint16(28, height);
  return bytes;
}

function webpLossless(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  bytes[20] = 0x2f;
  const bits = ((height - 1) << 14) | (width - 1);
  new DataView(bytes.buffer).setUint32(21, bits >>> 0, true);
  return bytes;
}

test("PNG terbaca", () => {
  assert.deepEqual(readImageDimensions(png(1200, 400)), {
    width: 1200,
    height: 400,
  });
  assert.deepEqual(readImageDimensions(png(1080, 1350)), {
    width: 1080,
    height: 1350,
  });
});

test("JPEG terbaca", () => {
  assert.deepEqual(readImageDimensions(jpeg(1200, 400)), {
    width: 1200,
    height: 400,
  });
});

test("WebP tiga varian terbaca", () => {
  assert.deepEqual(readImageDimensions(webpX(1200, 400)), {
    width: 1200,
    height: 400,
  });
  assert.deepEqual(readImageDimensions(webpLossy(1200, 400)), {
    width: 1200,
    height: 400,
  });
  assert.deepEqual(readImageDimensions(webpLossless(1200, 400)), {
    width: 1200,
    height: 400,
  });
});

test("rasio 1200x400 persis 3 di ketiga format", () => {
  // Angka yang sama dari tiga parser berbeda. Kalau salah satu meleset
  // offsetnya, hasilnya akan terlihat di sini bukan di layar pengguna.
  for (const bytes of [png(1200, 400), jpeg(1200, 400), webpX(1200, 400)]) {
    const dims = readImageDimensions(bytes);
    assert.ok(dims, "harus terbaca");
    assert.equal(dims.width / dims.height, 3);
  }
});

test("byte acak tidak menghasilkan angka karangan", () => {
  /*
   * Ini yang paling penting. Parser yang "coba-coba" akan mengembalikan
   * angka dari byte acak, dan angka itu akan tersimpan sebagai dimensi -
   * lalu popup menampilkan gambar dengan rasio yang tidak pernah ada.
   */
  const acak = new Uint8Array(64);
  for (let i = 0; i < acak.length; i++) acak[i] = (i * 37 + 11) & 0xff;

  assert.equal(readImageDimensions(acak), null);
});

test("data terlalu pendek tidak melempar", () => {
  for (const length of [0, 1, 4, 8, 11]) {
    const bytes = new Uint8Array(length);
    // Isi dengan signature PNG supaya parser Attempt menjalankan pathway-nya.
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].slice(0, length), 0);
    assert.equal(readImageDimensions(bytes), null, `panjang ${length}`);
  }
});

test("PNG dengan ukuran tidak masuk akal ditolak", () => {
  // Nol dan negatif tidak mungkin terjadi pada gambar sungguhan. Angka
  // sebesar ini hanya bisa dari byte yang salah dibaca.
  assert.equal(readImageDimensions(png(0, 400)), null);
  assert.equal(readImageDimensions(png(1200, 0)), null);
  assert.equal(readImageDimensions(png(9_000_000, 400)), null);
  assert.equal(readImageDimensions(png(400, 9_000_000)), null);
});

test("penanda JPEG dengan panjang segmen nol ditolak, bukan loop", () => {
  /*
   * Panjang 0 membuat penanda tidak punya panjang. Kalau skripnya
   * menghitung maju dari awal, satu gambar rusak bisa menggantungkan
   * seluruh backfill.
   */
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xe1], 2);
  new DataView(bytes.buffer).setUint16(4, 0);

  assert.equal(readImageDimensions(bytes), null);
});

test("JPEG dengan marker pengisi 0xFF dan 0x00 dilewati", () => {
  /*
   * Penanda pengisi `0xFF 0xFF` dan data hasil scan `0xFF 0x00` muncul
   * di antara segmen JPEG biasa. Parser harus melewatinya, bukan
   * salah membacanya sebagai awal frame header.
   */
  const bytes = new Uint8Array(34);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xff], 2); // pengisi
  bytes.set([0xff, 0x00], 4); // data hasil scan
  bytes.set([0xff, 0xc0], 24);
  new DataView(bytes.buffer).setUint16(26, 17);
  bytes[28] = 8;
  new DataView(bytes.buffer).setUint16(29, 400);
  new DataView(bytes.buffer).setUint16(31, 1200);

  assert.deepEqual(readImageDimensions(bytes), { width: 1200, height: 400 });
});

test("JPEG yang terpotong di tengah frame header menghasilkan null", () => {
  const bytes = new Uint8Array(28);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xc0], 24);
  // Panjang segmen ada, tapi lebar dan tinggi tidak pernah sampai.
  new DataView(bytes.buffer).setUint16(26, 17);

  assert.equal(readImageDimensions(bytes), null);
});

test("WebP dengan signature salah ditolak", () => {
  const lossy = webpLossy(1200, 400);
  lossy[23] = 0x00; // sync code rusak
  assert.equal(readImageDimensions(lossy), null);

  const lossless = webpLossless(1200, 400);
  lossless[20] = 0x00; // signature rusak
  assert.equal(readImageDimensions(lossless), null);
});

test("format di luar tiga yang didukung menghasilkan null", () => {
  // GIF dan berkas yang sama sekali bukan gambar.
  const gif = new Uint8Array(32);
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  assert.equal(readImageDimensions(gif), null);

  const bukanGambar = new Uint8Array(64);
  for (let i = 0; i < bukanGambar.length; i++) bukanGambar[i] = 0x7f;
  assert.equal(readImageDimensions(bukanGambar), null);
});

test("input kosong atau bukan byte array tidak melempar", () => {
  const kosong = [];
  assert.equal(readImageDimensions(kosong), null);
  assert.equal(readImageDimensions(undefined), null);
  assert.equal(readImageDimensions(null), null);
});