import fs from "node:fs";

import { readImageDimensions } from "../src/lib/image-dimensions.ts";

/**
 * Isi ulang dimensi gambar banner yang belum punya.
 *
 * Banner yang diunggah SEBELUM migration 051 tidak punya `image_width` dan
 * `image_height`. Popup membacanya dari `naturalWidth` saat gambar selesai
 * dimuat, jadi benar - tapi kotaknya melompat beberapa ratus milidetik
 * tepat di mata pengunjung. Skrip ini menghilangkan lompatan itu.
 *
 * KERING SEBAGAI BAWAHNYA
 *
 * Tanpa `--apply`, skrip hanya membaca dan mencetak. Melihat angkanya dulu
 * sebelum ada yang ditulis ke produksi adalah urutan yang benar: kalau
 * parser-nya salah offset, akibatnya bukan "tidak ada yang berubah" tapi
 * dimensi salah yang tersimpan diam-diam.
 *
 * Jalankan ulang kapan saja - aman, karena hanya menyentuh baris yang
 * dimensinya masih kosong.
 *
 *   node --experimental-strip-types --import ./scripts/tsconfig-alias-register.mjs \
 *        scripts/backfill-banner-dimensions.mjs
 *   node --experimental-strip-types --import ./scripts/tsconfig-alias-register.mjs \
 *        scripts/backfill-banner-dimensions.mjs --apply
 */

const APPLY = process.argv.includes("--apply");

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error("SUPABASE_URL atau SUPABASE_SECRET_KEY tidak ada di .env.local");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const rows = await fetch(
  `${url}/rest/v1/promo_banners?select=id,title,image_url,image_width,image_height` +
    `&image_width=is.null&order=id`,
  { headers },
);

if (!rows.ok) {
  console.error("Gagal membaca banner:", await rows.text());
  process.exit(1);
}

const banners = await rows.json();

console.log(`Mode: ${APPLY ? "TULIS" : "KERING (tidak ada yang diubah)"}`);
console.log(`Banner tanpa dimensi: ${banners.length}\n`);

if (banners.length === 0) {
  console.log("Tidak ada yang perlu diisi.");
  process.exit(0);
}

let berhasil = 0;
let gagal = 0;

for (const banner of banners) {
  process.stdout.write(`  #${banner.id} ${banner.title} ... `);

  let dimensions = null;

  try {
    const response = await fetch(banner.image_url);
    if (!response.ok) {
      console.log(`GAGAL: HTTP ${response.status}`);
      gagal += 1;
      continue;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    dimensions = readImageDimensions(bytes);
  } catch (error) {
    console.log(`GAGAL: ${error instanceof Error ? error.message : "tidak diketahui"}`);
    gagal += 1;
    continue;
  }

  if (!dimensions) {
    // Sengaja keras. Format di luar PNG/JPEG/WebP, atau byte yang rusak,
    // harus terlihat - bukan dilewati dengan diam.
    console.log("GAGAL: format tidak dikenal atau bytenya rusak");
    gagal += 1;
    continue;
  }

  const { width, height } = dimensions;

  if (APPLY) {
    const response = await fetch(
      `${url}/rest/v1/promo_banners?id=eq.${banner.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          image_width: width,
          image_height: height,
          updated_at: new Date().toISOString(),
        }),
      },
    );

    if (!response.ok) {
      console.log(`GAGAL menulis: ${await response.text()}`);
      gagal += 1;
      continue;
    }
  }

  const ratio = (width / height).toFixed(3);
  console.log(`${width}x${height} (rasio ${ratio})${APPLY ? " - ditulis" : " - akan ditulis"}`);
  berhasil += 1;
}

console.log(`\nBerhasil: ${berhasil}  Gagal: ${gagal}`);

if (!APPLY && berhasil > 0) {
  console.log("Jalankan ulang dengan --apply untuk menulisnya.");
}