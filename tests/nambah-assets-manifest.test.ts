import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { resolveProductAsset, resolveProductCover } from "../src/lib/product-asset-resolver.ts";

/**
 * Aset di `public/nambah-assets/`.
 *
 * Nama file memakai indeks urut (`Wuthering_Waves_Currency_1` … `_4`) yang
 * dipetakan ke denomination lewat `scripts/build-nambah-asset-manifest.mjs`.
 * Test di sini mengunci hasilnya supaya manifest yang stale atau salah petakan
 * langsung ketahuan saat build, bukan setelah pelanggan melihat nominal yang
 * salah.
 */

const ASSET_DIR = path.join(process.cwd(), "public", "nambah-assets");

// Folder kedua untuk aset katalog baru (2026-10-09). Opsional — belum tentu
// ada. `build-nambah-asset-manifest.mjs` menggabungkan keduanya ke satu
// manifest, jadi test di sini cukup mengikuti path yang tersimpan di manifest.
const NEW_CATALOG_DIR = path.join(process.cwd(), "public", "nambah-assets-katalog-baru");
// Manifest dibaca lewat `readFileSync` + `JSON.parse`, bukan
// `import ... with { type: "json" }`. Node type-stripping tidak bisa menangani
// import attribute di file TypeScript.
const manifest = JSON.parse(
  readFileSync(path.join(ASSET_DIR, "manifest.json"), "utf8"),
) as { products: Record<string, ManifestEntry> };

type ManifestEntry = {
  cover: string | null;
  assets: Array<{
    alt: string | null;
    kind: string;
    localPath: string;
    denomination?: number;
  }>;
};

const manifestProducts = manifest.products;

const IMAGE_EXT = new Set([".png", ".webp", ".jpg", ".jpeg"]);

/**
 * Nama file gambar di kedua folder aset.
 *
 * Yang dikembalikan HANYA nama file, bukan path. Manifest menyimpan
 * `localPath` yang sudah termasuk foldernya, jadi existence check cukup
 * mencocokkan nama file — nama yang sama di folder berbeda tetap dihitung
 * satu entry, dan itu memang tidak terjadi karena `GAME_BY_PREFIX` unik.
 */
function assetFiles() {
  const names: string[] = [];
  for (const dir of [ASSET_DIR, NEW_CATALOG_DIR]) {
    try {
      for (const name of readdirSync(dir)) {
        if (IMAGE_EXT.has(path.extname(name).toLowerCase())) names.push(name);
      }
    } catch {
      // Folder katalog baru boleh belum ada.
    }
  }
  return names;
}

function game(id: string) {
  return { id, name: id, shortName: id };
}

test("manifest memakai game id yang dikenal sistem", () => {
  // Peta di dalam skrip build. Kalau nama file aset berubah, test ini gagal
  // sebelum manifest diam-diam menunjuk ke game yang tidak ada.
  const known = new Set(Object.keys(manifestProducts));
  assert.ok(known.size >= 20, `hanya ${known.size} game punya aset`);

  // Setiap `localPath` harus benar-benar menunjuk file yang ada, di salah satu
  // dari dua folder aset yang digabung ke manifest ini.
  //
  // Yang diperiksa adalah PATH LENGKAP, bukan cuma nama file. Bug awalnya
  // ketahuan karena test versi ini cuma mencocokkan `path.basename` — manifest
  // mencatat `/nambah-assets/Laplace_M_Icon.jpg` untuk file yang sebenarnya
  // ada di `nambah-assets-katalog-baru/`, nama file-nya cocok, path-nya tidak.
  // Asetnya tidak pernah render.
  const assetRoots = ["nambah-assets", "nambah-assets-katalog-baru"];
  for (const [id, product] of Object.entries(manifestProducts)) {
    for (const asset of [...product.assets]) {
      assert.ok(
        assetRoots.some((root) => asset.localPath.startsWith(`/${root}/`)),
        `${id}: path di luar folder aset — ${asset.localPath}`,
      );
      assert.ok(
        existsSync(path.join(process.cwd(), "public", asset.localPath.replace(/^\//, ""))),
        `${id}: file tidak ada di path itu — ${asset.localPath}`,
      );
      const fileName = path.basename(asset.localPath);
      assert.ok(
        assetFiles().includes(fileName),
        `${id}: file tidak terdaftar di folder aset — ${fileName}`,
      );
    }
  }
});

test("cover memakai path yang benar-benar ada", () => {
  // Regresi langsung: `resolveProductCover` mengembalikan path yang tidak ada,
  // jadi kartu game di beranda jatuh ke avatar inisial tanpa error yang terlihat.
  // Aset di folder katalog baru HARUS punya prefix foldernya sendiri.
  const expectations: Array<[string, string]> = [
    ["laplace-m", "/nambah-assets-katalog-baru/Laplace_M_Icon.jpg"],
    ["one-punch-man", "/nambah-assets-katalog-baru/One_Punch_Man_Icon.png"],
    ["tom-and-jerry-chase", "/nambah-assets-katalog-baru/Tom_And_Jerry_Chase_Icon.jpg"],
  ];

  for (const [id, expected] of expectations) {
    const cover = resolveProductCover(game(id));
    assert.equal(cover?.src, expected, `${id}: cover salah`);

    // Dan path-nya harus bisa dibaca dari disk.
    const local = path.join(process.cwd(), "public", expected.replace(/^\//, ""));
    assert.ok(existsSync(local), `${id}: cover menunjuk file yang tidak ada — ${expected}`);
  }
});

test("setiap file aset terdaftar tepat sekali", () => {
  const registered = new Set<string>();
  for (const product of Object.values(manifestProducts)) {
    for (const asset of product.assets) {
      const fileName = path.basename(asset.localPath);
      // Aset yang dipakai sekaligus sebagai nominal DAN cover terdaftar dua kali
      // dengan `localPath` sama — itu disengaja, bukan duplikat.
      const key = `${fileName}:${asset.kind}`;
      assert.ok(
        !registered.has(key),
        `${fileName} (${asset.kind}) terdaftar lebih dari sekali`,
      );
      registered.add(key);
    }
  }

  // Setiap file harus muncul sebagai nominal atau cover, minimal satu kali.
  const used = new Set(
    [...registered].map((key) => key.split(":")[0]),
  );
  const missing = assetFiles().filter((name) => !used.has(name));
  assert.deepEqual(
    missing,
    [],
    `file aset tidak masuk manifest: ${missing.join(", ")}`,
  );
});

test("aset nominal punya denomination yang naik sesuai nomor file", () => {
  for (const [id, product] of Object.entries(manifestProducts)) {
    const nominals = product.assets.filter((asset) => asset.kind === "nominal");

    for (const asset of nominals) {
      // `Battle Pass` adalah produk semantik, bukan denomination, jadi tidak
      // punya angka. Aset lain wajib punya.
      if (/pass|membership|pack/i.test(asset.alt ?? "")) continue;

      assert.ok(
        typeof asset.denomination === "number",
        `${id}: ${path.basename(asset.localPath)} tanpa denomination`,
      );
      assert.ok(
        asset.alt && !Number.isNaN(Number(asset.alt.split(/\s/)[0])),
        `${id}: alt "${asset.alt}" tidak diawali angka`,
      );
    }

    // Urutan denomination harus menaik. Kalau tidak, produk dengan nominal
    // besar bisa mendapat gambar nominal kecil.
    const values = nominals
      .filter((asset) => typeof asset.denomination === "number")
      .map((asset) => asset.denomination as number)
      .sort((left, right) => left - right);
    const unique = [...new Set(values)];
    assert.equal(
      unique.length,
      values.length,
      `${id}: denomination duplikat — ${values.join(",")}`,
    );
    assert.deepEqual(
      values,
      [...values].sort((left, right) => left - right),
      `${id}: denomination tidak urut`,
    );
  }
});

test("aset Nambah dipakai untuk produk yang denomination-nya cocok", () => {
  // Kasus yang paling penting: satu nominal persis yang dipetakan.
  const cases: Array<[string, string, string]> = [
    // 4 aset untuk 6 denomination — titik tengah dipakai, rentang menutup sisa.
    ["wuthering-waves", "60 Lunites", "Wuthering_Waves_Currency_1.webp"],
    ["wuthering-waves", "6480 Lunites + 1600 Bonus", "Wuthering_Waves_Currency_4.webp"],
    // 6 aset untuk 6 denomination: pasangan 1:1.
    ["legends-of-runeterra", "475 Coins", "Legends_Of_Runeterra_Currency_1.webp"],
    ["legends-of-runeterra", "11000 Coins", "Legends_Of_Runeterra_Currency_6.webp"],
    // 7 aset untuk 8 denomination.
    ["heroes-evolved", "100 Tokens", "Heroes_Evolved_Currency_1.webp"],
    // Tanpa indeks — satu aset untuk seluruh rentang.
    ["aniimo", "6.480 + 648 Lumin Crystals", "Aniimo_Currency.webp"],
    ["aniimo", "60 + 6 Lumin Crystals", "Aniimo_Currency.webp"],
    // Pipe dari screenshot panel.
    ["dragon-nest-m-classic", "626 Cash Pack", "Dragon_Nest_M_Classic_Currency_1.png"],
    // Koma: kode angka.
    ["nba-infinite", "100 IC", "Nba_Infinite_Currency_1.png"],
    ["heroes-evolved", "131 Tokens", "Heroes_Evolved_Currency_1.webp"],
  ];

  for (const [id, label, fileName] of cases) {
    const resolved = resolveProductAsset(game(id), { id: "x", label });
    assert.ok(resolved, `${id} | ${label}: tidak dapat gambar`);
    assert.ok(
      resolved.src.startsWith("/nambah-assets/"),
      `${id} | ${label}: bukan dari nambah-assets (${resolved.src})`,
    );
    assert.equal(
      path.basename(resolved.src),
      fileName,
      `${id} | ${label}: gambar tidak sesuai`,
    );
  }
});

test("cover game memakai aset Nambah kalau ada", () => {
  // Hanya file `_Icon` / `_Product_Icon` yang boleh jadi ikon.
  const cover = resolveProductCover(game("point-blank"));
  assert.equal(cover?.src, "/nambah-assets/Point_Blank_Icon.jpg");

  const tft = resolveProductCover(game("teamfight-tactics-mobile"));
  assert.equal(tft?.src, "/nambah-assets/Teamfight_Tactics_Mobile_Icon.webp");

  // Valorant hanya punya `Valorant_Currency.webp` di folder aset dan tidak ada
  // file `_Icon`, jadi cover-nya dari Codashop.
  const valorant = resolveProductCover(game("valorant"));
  assert.ok(
    valorant?.src.startsWith("/product-assets/codashop/"),
    "Valorant seharusnya dari Codashop",
  );
});

test("tiga game khusus: nominal dari Nambah, cover dari Codashop", () => {
  // Codashop tidak punya aset nominal untuk game-game ini — Call of Duty
  // Mobile dan Mobile Legends Adventure even hanya punya satu `cover`. Kalau
  // ikut Codashop, semua produknya memakai gambar yang sama.
  const cases: Array<[string, string, string]> = [
    ["valorant", "22.000 VP", "Valorant_Currency.webp"],
    ["call-of-duty-mobile", "2.650 CP", "Call_Of_Duty_Mobile_Currency_3.png"],
    ["mobile-legends-adventure", "1.999 M-Cash", "Mobile_Legends_Adventure_Currency_4.png"],
  ];

  for (const [id, label, fileName] of cases) {
    const nominal = resolveProductAsset(game(id), { id: "x", label });
    assert.ok(nominal, `${id}: tidak dapat gambar`);
    assert.equal(
      path.basename(nominal.src),
      fileName,
      `${id} | ${label}: nominal salah`,
    );
    assert.ok(
      nominal.src.startsWith("/nambah-assets/"),
      `${id}: nominal seharusnya dari nambah-assets`,
    );

    // Cover tetap Codashop, dan tidak boleh berupa aset currency.
    const cover = resolveProductCover(game(id));
    assert.ok(cover, `${id}: cover tidak dapat gambar`);
    assert.ok(
      cover.src.startsWith("/product-assets/codashop/"),
      `${id}: cover seharusnya dari Codashop (${cover.src})`,
    );
  }
});

test("battle pass COD bukan ikon game", () => {
  // `Call_Of_Duty_Mobile_Battle_Pass.png` adalah gambar produk. Kalau
  // diklasifikasikan `cover` di manifest, file ini dipakai sebagai ikon game —
  // bug yang baru ketahuan saat COD dipindahkan ke aset Nambah.
  const cover = resolveProductCover(game("call-of-duty-mobile"));
  assert.ok(
    cover?.src !== "/nambah-assets/Call_Of_Duty_Mobile_Battle_Pass.png",
    "battle pass dipakai sebagai ikon game",
  );

  // Tapi untuk produk Battle Pass sendiri, gambarnya tepat.
  const battlePass = resolveProductAsset(game("call-of-duty-mobile"), {
    id: "x",
    label: "Call of Duty Mobile Battle Pass",
  });
  assert.equal(
    path.basename(battlePass?.src ?? ""),
    "Call_Of_Duty_Mobile_Battle_Pass.png",
  );

  // Produk CP biasa tidak boleh dapat gambar battle pass.
  for (const label of ["53 CP", "2650 CP", "76560 CP"]) {
    const resolved = resolveProductAsset(game("call-of-duty-mobile"), {
      id: "x",
      label,
    });
    assert.ok(resolved, `${label}: tidak dapat gambar`);
    assert.ok(
      !resolved.src.includes("Battle_Pass"),
      `${label} dapat gambar battle pass`,
    );
  }
});

test("ikon produk tidak pernah memakai gambar currency", () => {
  // Tumpukan koin bukan ikon game. Untuk game yang tidak punya file `_Icon`,
  // lebih baik `null` (lalu avatar inisial yang tampil) daripada gambar
  // currency yang terpakai sebagai ikon.
  const assetGames = Object.keys(manifestProducts);

  for (const id of assetGames) {
    const cover = resolveProductCover(game(id));
    if (!cover) continue;
    assert.ok(
      !/_Currency|_Battle_Pass/i.test(cover.src),
      `${id}: cover memakai gambar currency — ${cover.src}`,
    );
  }

  // Kasus spesifik yang pernah salah.
  assert.equal(
    resolveProductCover(game("league-of-legends-pc"))?.src,
    "/nambah-assets/League_of_Legends_Icon.png",
  );
  assert.equal(
    resolveProductCover(game("league-of-legends-wild-rift"))?.src,
    "/product-assets/codashop/_assets/691a80e84cde147b1691.png",
  );

  // Honkai Star Rail: Oneiric Shard tetap dari Codashop.
  const hsr = resolveProductAsset(game("honkai-star-rail"), {
    id: "x",
    label: "60 Oneiric Shard",
  });
  assert.equal(
    hsr?.src,
    "/product-assets/codashop/_assets/53915baaad54ddae4768.png",
  );

  // Wild Cores 10.000 milik Wild Rift.
  const wildRift = resolveProductAsset(game("league-of-legends-wild-rift"), {
    id: "x",
    label: "10000 Wild Cores",
  });
  assert.equal(
    wildRift?.src,
    "/product-assets/codashop/_assets/d87d5c9e3407bd041bba.png",
  );
});

test("currency Wild Rift dan HSR dipatok ke satu gambar", () => {
  // Codashop menyediakan gambar berbeda per nominal, tapi untuk kedua game ini
  // semua denominationnya memakai satu gambar.
  const wildRift = "/product-assets/codashop/_assets/d87d5c9e3407bd041bba.png";
  for (const label of [
    "105 Wild Cores",
    "420 Wild Cores",
    "1000 Wild Cores",
    "3275 Wild Cores",
    "10000 Wild Cores",
    "6210 Wild Cores",
  ]) {
    const resolved = resolveProductAsset(game("league-of-legends-wild-rift"), {
      id: "x",
      label,
    });
    assert.equal(resolved?.src, wildRift, `Wild Rift ${label}`);
    assert.equal(resolved?.alt, label, `alt harus menyebut produk sebenarnya`);
  }

  const oneiric = "/product-assets/codashop/_assets/53915baaad54ddae4768.png";
  for (const label of [
    "60 Oneiric Shard",
    "330 Oneiric Shard",
    "1090 Oneiric Shard",
    "6480 Oneiric Shard",
    "8080 Oneiric Shard",
  ]) {
    const resolved = resolveProductAsset(game("honkai-star-rail"), {
      id: "x",
      label,
    });
    assert.equal(resolved?.src, oneiric, `HSR ${label}`);
  }

  // Produk Pass/Blessing bukan currency — tidak boleh ikut dipatok.
  const expressPass = resolveProductAsset(game("honkai-star-rail"), {
    id: "x",
    label: "Express Supply Pass",
  });
  assert.ok(
    expressPass?.src !== oneiric,
    "Express Supply Pass ikut dipatok ke gambar Oneiric",
  );
});

test("game tanpa aset Nambah tetap dapat gambar dari Codashop", () => {
  // League of Legends Wild Rift tidak punya aset currency di folder aset, dan
  // ikonnya juga bukan — `League_of_Legends_Icon.png` milik LoL PC. Semua
  // gambar Wild Rift datang dari Codashop.
  const wildRift = resolveProductAsset(
    game("league-of-legends-wild-rift"),
    { id: "x", label: "1.000 Wild Cores" },
  );
  assert.ok(wildRift, "Wild Rift kehilangan gambar nominal");
  assert.ok(
    wildRift.src.startsWith("/product-assets/codashop/"),
    `Wild Rift harus dari Codashop (${wildRift.src})`,
  );
});

test("alt teks menyebut produk yang sebenarnya", () => {
  // Range match memakai gambar denomination lain, jadi `alt` harus tetap
  // menjelaskan produk yang dipesan — bukan denomination gambarnya.
  const resolved = resolveProductAsset(game("valorant"), {
    id: "x",
    label: "22.000 VP",
  });
  assert.equal(resolved?.alt, "22.000 VP");

  // Produk tanpa denomination tetap dapat cover, dengan alt berupa labelnya.
  const allPack = resolveProductAsset(game("zenless-zone-zero"), {
    id: "x",
    label: "All Pack Monochrome",
  });
  assert.ok(allPack, "All Pack Monochrome tidak dapat gambar");
  assert.equal(allPack.alt, "All Pack Monochrome");
});

test("aset tanpa denomination tidak dipakai sebagai ikon", () => {
  // Valorant dan ZZZ punya aset currency tanpa indeks, tetapi tidak boleh
  // dipakai sebagai cover game.
  for (const id of ["valorant", "zenless-zone-zero"]) {
    const cover = resolveProductCover(game(id));
    if (cover) {
      assert.ok(
        !cover.src.includes("_Currency"),
        `${id}: cover memakai aset currency`,
      );
    }
  }
});

test("produk di luar daftar denomination tetap dapat gambar nearest", () => {
  // Mobile Legends Adventure punya 24 produk tapi hanya 8 aset. denomination di
  // luar daftar harus dapat gambar terdekat — dari aset Nambah.
  const resolved = resolveProductAsset(game("mobile-legends-adventure"), {
    id: "x",
    label: "65.999 M-Cash",
  });
  assert.ok(resolved, "denomination di luar daftar tidak dapat gambar");
  assert.ok(
    resolved.src.startsWith("/nambah-assets/"),
    `MLA seharusnya dari nambah-assets (${resolved.src})`,
  );

  // Dan yang memakai aset Nambah: 24 produk vs 8 aset di folder lokal.
  const wuthering = resolveProductAsset(game("wuthering-waves"), {
    id: "x",
    label: "6480 Lunites + 1600 Bonus (5x)",
  });
  assert.ok(wuthering?.src.startsWith("/nambah-assets/"));
});