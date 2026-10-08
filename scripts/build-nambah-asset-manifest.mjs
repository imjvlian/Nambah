/**
 * Membangun manifest untuk `public/nambah-assets/`.
 *
 * Aset di folder itu diberi nomor indeks berurutan —
 * `Wuthering_Waves_Currency_1.webp`, `_2`, `_3`, `_4` — dan indeksnya mencerminkan
 * nilai yang **menaik**: denomination terkecil memakai `_1`.
 *
 * Buktinya `Legends_Of_Runeterra`: 6 aset dengan 6 denomination
 * (475, 1000, 2050, 3650, 5350, 11000). `_1` menumpuk beberapa koin, `_6`
 * peti penuh koin — urutannya naik, bukan acak.
 *
 * Karena jumlah aset hampir selalu lebih SEDIKIT dari jumlah produk, aset
 * disebar rata di antara denomination yang ada, bukan diambil dari yang
 * terkecil. Ini penting: `findRangeNominalAsset` di
 * `src/lib/product-asset-resolver.ts` memakai titik tengah antar denomination
 * sebagai batas rentang. Kalau semua aset dijekan ke denomination terkecil,
 * produk 22.000 Valorant akan memakai gambar VP terkecil.
 *
 * Jalankan: `node scripts/build-nambah-asset-manifest.mjs`
 */

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ASSET_DIR = path.join(ROOT, "public", "nambah-assets");
const MANIFEST_PATH = path.join(ASSET_DIR, "manifest.json");

/** Prefiks nama file -> game id. */
const GAME_BY_PREFIX = {
  Aniimo: "aniimo",
  Arena_Of_Valor: "arena-of-valor",
  Call_Of_Duty_Mobile: "call-of-duty-mobile",
  Delta_Force: "delta-force",
  Dragon_Nest_M_Classic: "dragon-nest-m-classic",
  Fc_Mobile: "fc-mobile",
  Google_Play_Voucher: "google-play-indonesia",
  Heroes_Evolved: "heroes-evolved",
  // `League_of_Legends_Icon.png` (tanpa `Pc`) adalah ikon untuk League of
  // Legends PC. Wild Rift tidak punya aset di folder ini sama sekali — ikon
  // dan Wild Cores-nya datang dari Codashop.
  League_of_Legends: "league-of-legends-pc",
  League_Of_Legends_Pc: "league-of-legends-pc",
  Legends_Of_Runeterra: "legends-of-runeterra",
  Marvel_Rivals: "marvel-rivals",
  Mobile_Legends_Adventure: "mobile-legends-adventure",
  Nba_Infinite: "nba-infinite",
  Point_Blank: "point-blank",
  Ragnarok_M_Eternal_Love: "ragnarok-m-eternal-love",
  State_Of_Survival: "state-of-survival",
  Teamfight_Tactics_Mobile: "teamfight-tactics-mobile",
  Valorant: "valorant",
  // "Zenles" (e ganda) mengikuti penamaan file yang sudah ada di folder ini.
  Zenles_Zone_Zero: "zenless-zone-zero",
  Where_Winds_Meet: "where-winds-meet",
  Wuthering_Waves: "wuthering-waves",
};

/**
 * Snapshot denomination unik per game, dari tabel `products` (`active = true`),
 * diurutkan naik.
 *
 * Ini perlu diperbarui kalau Digiflazz menambah denomination baru. Ambil ulang
 * dengan:
 *
 *   curl "$SUPABASE_URL/rest/v1/products?select=label&game_id=eq.<id>&active=eq.true"
 *
 * Angka ditulis sebagai integer TANPA pemisah ribuan supaya `numberValues()`
 * di resolver membacanya sama.
 */
const DENOMINATIONS = {
  "aniimo": { unit: "Lumin Crystals", values: [60, 300, 980, 1980, 3280, 6480] },
  "arena-of-valor": { unit: "Vouchers", values: [7, 18, 40, 90, 130, 230, 320, 470, 510, 560, 600, 700, 950, 1180, 1430, 1900, 2390, 3340, 4780, 4800, 7170, 9560, 24050, 48200] },
  "call-of-duty-mobile": { unit: "CP", values: [26, 31, 53, 62, 63, 106, 112, 127, 128, 165, 191, 256, 264, 278, 320, 331, 390, 443, 528, 640, 693, 746, 800, 859, 928, 1024, 1056, 1268, 1373, 1584, 1675, 2059, 2067, 2640, 3564, 4013, 4209, 5280, 5618, 6264, 7656, 8301, 9029, 9716, 10406, 10560, 11238, 13275, 15312, 22968, 26400, 38280, 52800, 76560] },
  "delta-force": { unit: "Delta Coins", values: [18, 60, 300, 420, 680, 1280, 1680, 3280, 6480, 12960, 19440] },
  "dragon-nest-m-classic": { unit: "Cash Pack", values: [626, 3130, 6366, 12800, 19500, 32900, 66000, 132000, 198000, 264000, 330000] },
  "fc-mobile": { unit: "", values: [40, 100, 520, 1070, 2200, 5750, 12000] },
  "google-play-indonesia": { unit: "", values: [5000, 10000, 16000, 49000, 50000] },
  "heroes-evolved": { unit: "Tokens", values: [100, 200, 240, 500, 1200, 2500, 6500, 14000] },
  "league-of-legends-pc": { unit: "RP", values: [575, 1380, 2800, 4500, 6500, 13500] },
  "league-of-legends-wild-rift": { unit: "Wild Cores", values: [105, 350, 420, 585, 700, 1000, 1135, 1375, 1660, 1830, 1850, 2400, 3010, 3275, 4000, 4800, 6210, 10000] },
  "legends-of-runeterra": { unit: "Coins", values: [475, 1000, 2050, 3650, 5350, 11000] },
  "marvel-rivals": { unit: "Lattices", values: [100, 500, 1000, 2180, 5680, 11680] },
  "mobile-legends-adventure": { unit: "M-Cash", values: [13, 33, 132, 239, 411, 477, 665, 954, 1499, 1676, 1999, 2386, 2999, 3000, 3818, 4772, 4999, 5000, 7158, 9999, 10000, 10999, 32999, 65999] },
  "nba-infinite": { unit: "IC", values: [100, 200, 500, 1000, 2000, 3000, 5000, 10000] },
  "point-blank": { unit: "PB Cash", values: [1200, 2400, 6000, 7000, 8400, 12000, 15000, 18000, 24000, 30000, 36000, 40800, 45000, 60000, 70000, 72000, 90000] },
  "ragnarok-m-eternal-love": { unit: "Big Cat Coins", values: [1, 3, 4, 5, 6, 7, 12, 18, 20, 24, 30, 36, 40, 60, 72, 80, 120, 145, 202, 298, 373, 400, 598, 748, 1196, 1532, 2990, 3993, 9012] },
  "state-of-survival": { unit: "Diamonds", values: [100, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 500000] },
  "teamfight-tactics-mobile": { unit: "TFT Coins", values: [575, 1380, 2800, 4500, 6500, 13500] },
  valorant: { unit: "VP", values: [475, 950, 1000, 1475, 2000, 2050, 2525, 3050, 3650, 4125, 4650, 5350, 5700, 5825, 6350, 7300, 7400, 8990, 10700, 11000, 11100, 11475, 12000, 13050, 14650, 22000] },
  "where-winds-meet": { unit: "Echo Beads", values: [60, 180, 300, 600, 900, 1800, 3000, 6000, 12000] },
  "wuthering-waves": { unit: "Lunites", values: [60, 300, 980, 1980, 3280, 6480] },
  "zenless-zone-zero": { unit: "Monochrome", values: [60, 300, 980, 1980, 3280, 6480] },
};

const IMAGE_EXT = new Set([".png", ".webp", ".jpg", ".jpeg"]);

/** Label yangVcocok dengan produk Nambah untuk satu denomination. */
function labelFor(gameId, value) {
  const meta = DENOMINATIONS[gameId];
  const unit = meta?.unit ?? "";
  return unit ? `${value} ${unit}` : `${value}`;
}

/**
 * Menyebar `count` aset ke `count` posisi yang sama rata di antara `total`
 * denomination.
 *
 * `count === total` memberi pasangan 1:1 (persis yang terjadi di Legends of
 * Runeterra). Kalau `count < total`, tiap aset mewakili rentang yang lebarnya
 * sebanding — itulah yang membuat range fallback di resolver bekerja.
 */
function spread(count, total) {
  if (count <= 0) return [];
  if (count >= total) {
    return Array.from({ length: total }, (_, index) => index);
  }
  if (count === 1) return [Math.floor((total - 1) / 2)];

  const positions = [];
  for (let i = 0; i < count; i += 1) {
    positions.push(Math.round((i * (total - 1)) / (count - 1)));
  }
  return [...new Set(positions)];
}

/**
 * Mengurai satu nama file menjadi prefix, jenis, dan indeks.
 *
 * Dua bentuk tidak biasa sengaja diterima:
 *
 * - `Dragon_Nest_M_Classic_Currency_.png` — underscore menggantung tanpa
 *   angka. File lain di kelompok itu bernomor 1, 3, 4, 5, 6, jadi yang
 *   menggantung ini adalah nomor 2. Kalau ditolak, satu denomination Dragon
 *   Nest tidak punya gambar sama sekali.
 * - `Google_Play_Voucher.png` — tanpa jenis. Tanpa `Currency`/`Icon` berarti
 *   satu-satunya gambar untuk game itu, jadi diperlakukan sebagai cover.
 */
function parsePrefix(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");

  // `(_\d+)?` capturing opsional supaya underscore menggantung
  // (`Dragon_Nest_M_Classic_Currency_`) tetap cocok; `_\d+` capturing wajib
  // supaya `Currency_1` tidak ditafsirkan sebagai prefix "Currency_1".
  const withKind = base.match(/^(.*?)_(Currency|Battle_Pass|Product_Icon|Icon)(?:_(\d+)|_)?$/);
  if (withKind) {
    const [, prefix, kind, digits] = withKind;
    const gameId = GAME_BY_PREFIX[prefix];
    if (!gameId) return null;

    const isDangling = digits === undefined && /_$/.test(base);
    return {
      gameId,
      // Hanya `Icon` dan `Product_Icon` yang boleh jadi ikon game.
      // `Battle_Pass` adalah gambar produk, bukan ikon — kalau diletakkan di
      // sini, `Call_Of_Duty_Mobile_Battle_Pass.png` akan jadi cover COD.
      kind: kind === "Currency" || kind === "Battle_Pass" ? "nominal" : "cover",
      special: kind === "Battle_Pass",
      index: digits === undefined ? null : Number(digits),
      dangling: isDangling,
    };
  }

  const bare = base.match(/^(.*?)(?:_(?:Voucher))?$/);
  if (!bare) return null;
  const gameId = GAME_BY_PREFIX[bare[1]] ?? GAME_BY_PREFIX[base];
  if (!gameId) return null;

  return {
    gameId,
    kind: "cover",
    special: false,
    index: null,
    dangling: false,
  };
}

async function main() {
  let entries;
  try {
    entries = await readdir(ASSET_DIR, { withFileTypes: true });
  } catch {
    throw new Error(`Folder aset tidak ditemukan: ${ASSET_DIR}`);
  }

  const files = entries
    .filter((entry) => entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();

  const grouped = new Map();
  const unknown = [];

  for (const fileName of files) {
    const parsed = parsePrefix(fileName);
    if (!parsed) {
      unknown.push(fileName);
      continue;
    }
    const list = grouped.get(parsed.gameId) ?? [];
    list.push({ ...parsed, fileName });
    grouped.set(parsed.gameId, list);
  }

  const products = {};
  let assetCount = 0;

  for (const [gameId, list] of grouped) {
    const meta = DENOMINATIONS[gameId];
    const denominations = meta?.values ?? [];

    // Isi underscore yang menggantung dengan celah terkecil yang belum terpakai.
    //
    // Dragon Nest bernomor 1, 3, 4, 5, 6 — celahnya ada di 2, bukan di
    // setelah 6. Mengisi dengan "max + 1" akan menaruh file itu di urutan
    // terakhir, sehingga `626` dan `330000` tertukar dengan Tetangga yang
    // salah.
    const dangling = list.filter((item) => item.dangling);
    if (dangling.length > 0) {
      const used = new Set(
        list
          .filter((item) => item.index !== null && !item.dangling)
          .map((item) => item.index),
      );
      let next = 1;
      for (const item of dangling) {
        while (used.has(next)) next += 1;
        item.index = next;
        used.add(next);
        next += 1;
      }
    }

    const numbered = list
      .filter((item) => item.index !== null)
      .sort((left, right) => left.index - right.index);

    // Aset nominal tanpa indeks — `Valorant_Currency.webp`,
    // `Aniimo_Currency.webp`, `Point_Blank_Currency.webp`. Tidak ada angka di
    // nama filenya, jadi tidak bisa dipetakan ke denomination tertentu.
    //
    // Perlakuannya: satu aset untuk seluruh rentang. Dipasangkan ke
    // denomination tengah supaya posisinya di tengah daftar, dan
    // `findRangeNominalAsset` akan memakainya untuk semua nominal game itu
    // karena hanya ada satu kandidat. Lebih baik daripada `null`.
    const unindexed = list.filter(
      (item) => item.index === null && item.kind === "nominal" && !item.special,
    );
    const covers = list.filter((item) => item.kind === "cover");
    const specials = list.filter((item) => item.special);

    const assets = [];

    if (numbered.length > 0 && denominations.length > 0) {
      const positions = spread(numbered.length, denominations.length);
      numbered.forEach((item, assetIndex) => {
        const position = positions[assetIndex] ?? positions[positions.length - 1];
        const value = denominations[position];
        assets.push({
          alt: labelFor(gameId, value),
          kind: "nominal",
          localPath: `/nambah-assets/${item.fileName}`,
          denomination: value,
        });
      });
    } else if (numbered.length > 0) {
      // Tidak ada denomination yang diketahui — pakai nama file sebagai alt.
      // `scoreNominalAsset` akan menolak karena tidak ada angka yang cocok,
      // jadi aset ini tidak akan salah dipakai.
      for (const item of numbered) {
        assets.push({
          alt: `${gameId} currency`,
          kind: "nominal",
          localPath: `/nambah-assets/${item.fileName}`,
        });
      }
    }

    // Aset nominal tanpa indeks, dipasang ke denomination tengah.
    for (const item of unindexed) {
      const middle = denominations.length > 0
        ? denominations[Math.floor((denominations.length - 1) / 2)]
        : null;
      assets.push({
        alt: middle === null ? `${gameId} currency` : labelFor(gameId, middle),
        kind: "nominal",
        localPath: `/nambah-assets/${item.fileName}`,
        ...(middle === null ? {} : { denomination: middle }),
      });
    }

    for (const item of specials) {
      // `alt` memuat frasa "battle pass" supaya `specialIntent()` di resolver
      // mencocokkannya hanya ke produk Battle Pass, bukan ke semua nominal.
      assets.push({
        alt: "Battle Pass",
        kind: "nominal",
        localPath: `/nambah-assets/${item.fileName}`,
      });
    }

    const cover = covers[0];
    if (cover) {
      assets.push({
        alt: null,
        kind: "cover",
        localPath: `/nambah-assets/${cover.fileName}`,
      });
    }

    // Sengaja TIDAK ada fallback "pakai aset currency sebagai cover".
    //
    // Ikon produk harus Frontier/ikon game, bukan tumpukan koin. ZZZ dan
    // Valorant hanya punya `*_Currency.*` di folder ini; memakainya sebagai
    // cover membuat kartu game di beranda menampilkan tumpukan mata uang, dan
    // untuk League of Legends PC hasilnya `League_Of_Legends_Pc_Currency_1`
    // yang dipakai sebagai ikon — persis yang tidak diinginkan.
    //
    // Game tanpa file `_Icon`/_Product_Icon` akan memakai cover Codashop kalau
    // ada, atau kembali ke avatar inisial seperti sebelumnya.

    if (assets.length === 0) continue;

    const coverPath = cover
      ? `/nambah-assets/${cover.fileName}`
      : (assets.find((asset) => asset.kind === "cover")?.localPath ?? null);

    products[gameId] = {
      name: gameId,
      source: "nambah-assets",
      cover: coverPath,
      assets,
    };
    assetCount += assets.length;
  }

  const manifest = {
    version: 1,
    source: "public/nambah-assets",
    generatedBy: "scripts/build-nambah-asset-manifest.mjs",
    products,
  };

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const info = await stat(MANIFEST_PATH);
  console.log(`manifest ditulis: ${path.relative(ROOT, MANIFEST_PATH)} (${info.size} byte)`);
  console.log(`game dengan aset: ${Object.keys(products).length} / ${grouped.size} kelompok`);
  console.log(`total aset terdaftar: ${assetCount}`);

  if (unknown.length > 0) {
    console.log(`\n${unknown.length} file tidak dikenali prefix-nya:`);
    for (const name of unknown) console.log(`  ${name}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});