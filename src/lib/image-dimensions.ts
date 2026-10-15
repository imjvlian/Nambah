/**
 * Pembaca dimensi gambar dari byte mentah.
 *
 * MURNI: tidak ada DOM, tidak ada fetch, tidak ada database. Hanya byte
 * masuk dan angka keluar - itu yang membuat parser bisa diuji dengan
 * crafted bytes tanpa file gambar sungguhan.
 *
 * KENAPA TIDAK CUKUP MEMBAWA UKURAN DARI SERVER
 *
 * Upload baru sudah menyimpan dimensi karena respons Cloudinary menyertakan
 * `width` dan `height`. Fungsi ini untuk banner yang diunggah SEBELUM itu
 * ada, yang tidak punya kolomnya terisi. Tanpa ini, popup
 * banner lama harus menebak dari `naturalWidth` dan melompat saat gambar
 * selesai dimuat.
 *
 * HANYA TIGA FORMAT
 *
 * `validateBannerImage` hanya menerima JPG, PNG, dan WebP, jadi tiga itu
 * saja yang perlu dibaca. Format lain mengembalikan `null` - bukan tebakan,
 * karena angka yang salah membuat popup menampilkan gambar dengan rasio
 * keliru dan tidak ada yang mengetahuinya.
 */

export type ImageDimensions = { width: number; height: number };

/** Batas realistis. Angka di atas ini hanya bisa dari byte yang salah baca. */
const MAX_SIDE = 50_000;

function valid(width: number, height: number): ImageDimensions | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_SIDE || height > MAX_SIDE) return null;
  return { width, height };
}

function readPng(bytes: Uint8Array): ImageDimensions | null {
  // Signature 89 50 4E 47 0D 0A 1A 0A, lalu chunk IHDR dengan ukuran
  // dan tinggi tepat di offset 16 dan 20.
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e) return null;
  if (bytes[3] !== 0x47 || bytes[12] !== 0x49 || bytes[13] !== 0x48) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return valid(view.getUint32(16), view.getUint32(20));
}

function readJpeg(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /*
   * Penanda JPEG berurutan: FF <kode>, lalu panjang 2 byte, lalu isi.
   * SOF0..SOF15 memegang ukuran, KECUALI empat di antaranya yang bukan
   * frame header sama sekali - C4 (DHT), C8 (JPG), CC (DAC), dan setiap
   * kode non-SOF di luarnya.
   */
  const NON_FRAME_MARKERS = new Set([0xc4, 0xc8, 0xcc]);

  let offset = 2;

  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];

    // 0xFF dipakai sebagai pengisi, dan 0x00 menandai data hasil scan.
    if (marker === 0xff || marker === 0x00) {
      offset += 1;
      continue;
    }

    const isFrameStart =
      marker >= 0xc0 && marker <= 0xcf && !NON_FRAME_MARKERS.has(marker);

    if (isFrameStart) {
      if (offset + 9 > bytes.length) return null;
      // offset+2 = panjang segmen, +3 = presisi, +4..5 = tinggi, +6..7 = lebar
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return valid(width, height);
    }

    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const segmentLength = view.getUint16(offset + 2);
    // Panjang 0 berarti penanda tidak punya panjang - mengulang dari awal
    // akan loop tanpa henti pada data rusak.
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }

  return null;
}

function readWebp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;

  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWebp =
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isRiff || !isWebp) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = String.fromCharCode(
    bytes[12], bytes[13], bytes[14], bytes[15],
  );

  // VP8X: 4 byte flag, lalu lebar dan tinggi kanvas 24-bit (nilai dikurangi 1).
  if (format === "VP8X") {
    const width = view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16);
    const height = view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16);
    return valid(width + 1, height + 1);
  }

  // VP8 lossy: 3 byte frame tag, sync code 9D 01 2A, lalu lebar/tinggi 14-bit.
  if (format === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = view.getUint16(26) & 0x3fff;
    const height = view.getUint16(28) & 0x3fff;
    return valid(width, height);
  }

  // VP8L lossless: byte signature 0x2F, lalu 14 bit lebar-1 dan 14 bit tinggi-1.
  if (format === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = view.getUint32(21, true);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return valid(width, height);
  }

  return null;
}

/**
 * Dimensi gambar, atau `null` kalau formatnya tidak dikenali atau bytenya
 * rusak.
 *
 * Mengembalikan `null` - bukan menebak - adalah keputusan yang disengaja.
 * Nilai yang salah di sini tidak akan terlihat sebagai salah: browser hanya
 * akan menampilkan gambar lebih pendek atau lebih tinggi, dan hasilnya tetap
 * "cukup bagus" sampai ada yang mengeluh dua minggu kemudian.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!bytes || bytes.length < 12) return null;

  try {
    return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
  } catch {
    // DataView bisa melempar kalau byte-nya tidak cukup. Byte rusak harus
    // berarti "tidak diketahui", bukan exception yang menjatuhkan skrip.
    return null;
  }
}