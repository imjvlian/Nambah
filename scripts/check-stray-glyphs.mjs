/**
 * Deteksi skrip non-Latin yang bocor ke dalam komentar.
 *
 * Menjalankan:
 *   node scripts/check-stray-glyphs.mjs [file ...]
 *
 * Tanpa argumen, semua file .ts/.tsx/.mjs yang di-track git ikut diperiksa.
 *
 * Kenapa perlu ada alat ini: beberapa kali teks Arab/CJK bocor ke dalam
 * komentar Indonesia saat menulis lewat edit skrip. Detector CJK biasa
 * (rentang \u3000-\u9fff) TIDAK menangkap Aksara Arab, jadi bug yang sama
 * lolos dua kali. Di sini yang dicek adalah "apa pun yang bukan Latin" -
 * lebih lebar, tapi memegtahankan daftar putih untuk tanda baca sah.
 */

/**
 * Karakter non-ASCII yang BOLEH muncul.
 *
 * Daftar putih ini sengaja longgar: teguk kotak ASCII-art (U+2500),
 * panah, dan elipsis dipakai luas di komentar codebase ini. Semuanya
 * ditambahkan karena benar-benar dipakai, bukan karena "mungkin berguna".
 */
const ALLOWED_CODEPOINTS = new Set([
  // Tanda baca typografis.
  0x2013, // en dash
  0x2014, // em dash
  0x2018, 0x2019, // kutip tunggal
  0x201c, 0x201d, // kutip ganda
  0x2026, // ellipsis
  // Panah.
  0x2190, 0x2192, 0x2194, 0x21d2, 0x21d4,
  // Teguk kotak untuk diagram ASCII.
  0x2500, 0x2502, 0x250c, 0x2510, 0x2514, 0x2518, 0x251c, 0x2524,
  0x252c, 0x2534, 0x253c, 0x2550, 0x2551, 0x2554, 0x2557, 0x255a,
  0x255d, 0x2560, 0x2563, 0x2566, 0x2569, 0x256c,
  // Simbol umum yang lain.
  0x00b0, // degree
  0x00d7, // times
  0x2022, // bullet
  0x2212, // minus sign
  0x2713, 0x2717, // check / ballot x
]);

function isAllowed(codePoint) {
  if (codePoint < 128) return true;
  // Latin-1 Supplement + Latin Extended-A/B: nama dengan aksen.
  if (codePoint >= 0x00a0 && codePoint <= 0x024f) return true;
  return ALLOWED_CODEPOINTS.has(codePoint);
}

function findStrays(text) {
  const strays = [];
  let index = 0;
  for (const char of text) {
    if (!isAllowed(char.codePointAt(0))) {
      strays.push({ char, index });
    }
    index += char.length;
  }
  return strays;
}

const files = process.argv.slice(2);

let targets = files;
if (targets.length === 0) {
  const { execFileSync } = await import("node:child_process");
  const listed = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  targets = listed
    .split(/\r?\n/)
    .filter((file) => /\.(ts|tsx|mjs|js|css|sql)$/.test(file));
}

const fs = await import("node:fs");

let dirty = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const strays = findStrays(text);
  if (strays.length === 0) continue;

  const seen = new Set();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const { char } of findStrays(lines[i])) {
      if (seen.has(char)) continue;
      seen.add(char);
      console.log(`${file}:${i + 1}  [${char.codePointAt(0).toString(16)}] ${char}`);
    }
  }
  dirty += 1;
}

console.log(
  dirty === 0
    ? `Bersih: ${targets.length} file diperiksa.`
    : `${dirty} file bermasalah.`,
);
process.exitCode = dirty === 0 ? 0 : 1;