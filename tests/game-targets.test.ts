import assert from "node:assert/strict";
import test from "node:test";
import {
  getGameAccountSchema,
  validateGameAccountTarget,
} from "../src/lib/game-account.ts";
import {
  CURATED_GAME_TARGETS,
  gamesMissingCuratedTarget,
  getCuratedGameTarget,
} from "../src/lib/game-targets.ts";
import { renderFulfillmentTarget } from "../src/lib/fulfillment-target.ts";

/**
 * Lima game yang ditambahkan saat katalog tumbuh dari 1170 ke 1233 produk.
 *
 * Semuanya sebelumnya jatuh ke `generic` (field teks bebas) DAN lahir dengan
 * `fulfillment_target_template` kosong — hasil `catalog-sync` yang membuat game
 * baru hanya dari nama brand. Test di sini mengunci keduanya.
 *
 * Sumber: kolom "Deskripsi Produk" di Digiflazz Buyer Member Panel, dikunci
 * silang dengan dokumentasi publisher (HoYoverse untuk UID Star Rail, Riot
 * untuk Riot ID, daengdiamondstore untuk server Ragnarok M).
 */

test("lima game baru punya skema khusus, bukan generic", () => {
  const cases = [
    { id: "ragnarok-m-eternal-love", name: "Ragnarok M: Eternal Love", kind: "ragnarok-m" },
    { id: "honkai-star-rail", name: "Honkai: Star Rail", kind: "honkai-star-rail" },
    { id: "heroes-evolved", name: "Heroes Evolved", kind: "numeric-player" },
    { id: "league-of-legends-pc", name: "League of Legends PC", kind: "valorant" },
    { id: "teamfight-tactics-mobile", name: "Teamfight Tactics Mobile", kind: "numeric-player" },
  ];

  for (const item of cases) {
    for (const requiresServer of [false, true]) {
      const schema = getGameAccountSchema({
        id: item.id,
        name: item.name,
        requiresServer,
      });
      assert.notEqual(schema.kind, "generic", `${item.id} masih generic`);
      assert.equal(schema.kind, item.kind, `${item.id} kind salah`);
    }
  }
});

test("league of legends PC memakai Riot ID, TFT Mobile tidak", () => {
  // Keduanya game Riot, tapi contoh ID dari supplier TFT Mobile adalah
  // `123456780000` — numerik. Memaksa Riot ID ke sana akan menolak semua order
  // yang sah.
  const lol = getGameAccountSchema({
    id: "league-of-legends-pc",
    name: "League of Legends PC",
  });
  assert.equal(lol.user.label, "Riot ID");
  assert.ok(
    validateGameAccountTarget({ id: "league-of-legends-pc", name: "LOL PC" }, "Pemain#ID1").ok,
    "Riot ID tidak diterima",
  );
  assert.equal(
    validateGameAccountTarget({ id: "league-of-legends-pc", name: "LOL PC" }, "123456789").ok,
    false,
    "ID numerik lolos untuk game Riot",
  );

  const tft = getGameAccountSchema({
    id: "teamfight-tactics-mobile",
    name: "Teamfight Tactics Mobile",
  });
  assert.equal(tft.user.label, "User ID");
  assert.ok(
    validateGameAccountTarget(
      { id: "teamfight-tactics-mobile", name: "TFT Mobile" },
      "123456780000",
    ).ok,
    "User ID numerik ditolak untuk TFT Mobile",
  );
  assert.equal(
    validateGameAccountTarget(
      { id: "teamfight-tactics-mobile", name: "TFT Mobile" },
      "Pemain#ID1",
    ).ok,
    false,
    "Riot ID lolos untuk TFT Mobile",
  );
});

test("ragnarok m: Character ID + dropdown lima server", () => {
  const game = {
    id: "ragnarok-m-eternal-love",
    name: "Ragnarok M: Eternal Love",
    requiresServer: true,
  };
  const schema = getGameAccountSchema(game);

  assert.equal(schema.user.label, "Character ID");
  assert.deepEqual(schema.server?.options, [
    "Eternal Love",
    "Midnight Party",
    "Memory Of Faith",
    "Valhalla Glory",
    "Port City",
  ]);
  // Server berupa nama dengan spasi — harus teks, tidak boleh kolom numerik.
  assert.ok(validateGameAccountTarget(game, "123378499", "Eternal Love").ok);
  assert.ok(
    validateGameAccountTarget(game, "123378499", "Midnight Party").ok,
    "Midnight Party adalah server yang valid",
  );
  assert.equal(
    validateGameAccountTarget(game, "123378499", "midnight party").ok,
    false,
    "server dengan huruf kecil lolos",
  );
  assert.equal(
    validateGameAccountTarget(game, "123378499", "Server").ok,
    false,
    "server di luar daftar lolos",
  );
  assert.equal(validateGameAccountTarget(game, "123378499", "").ok, false);
});

test("honkai star rail memakai daftar region yang sama dengan Genshin", () => {
  const genshin = getGameAccountSchema({
    id: "genshin-impact",
    name: "Genshin Impact",
    requiresServer: true,
  });
  const hsr = getGameAccountSchema({
    id: "honkai-star-rail",
    name: "Honkai: Star Rail",
    requiresServer: true,
  });

  assert.equal(hsr.user.label, "UID");
  assert.deepEqual(hsr.server?.options, genshin.server?.options);

  const game = { id: "honkai-star-rail", name: "Honkai: Star Rail", requiresServer: true };
  assert.ok(validateGameAccountTarget(game, "123456789", "Asia").ok);
  assert.equal(validateGameAccountTarget(game, "123456789", "asia").ok, false);
  assert.equal(validateGameAccountTarget(game, "12345", "Asia").ok, false);
});

test("heroes evolved: Player ID + server, checker aktif", () => {
  const game = {
    id: "heroes-evolved",
    name: "Heroes Evolved",
    requiresServer: true,
  };
  const schema = getGameAccountSchema(game);

  assert.equal(schema.user.label, "Player ID");
  assert.ok(schema.server, "server tidak muncul padahal requires_server true");
  assert.equal(schema.checker, "universal");

  assert.ok(validateGameAccountTarget(game, "123456", "SEA").ok);
  assert.equal(validateGameAccountTarget(game, "abc", "SEA").ok, false);
  assert.equal(validateGameAccountTarget(game, "123456", "").ok, false);
  // Server sekarang dropdown wilayah, jadi teks angka tidak lagi berlaku.
  assert.equal(
    validateGameAccountTarget(game, "123456", "1").ok,
    false,
    "server angka lolos untuk dropdown wilayah",
  );
});

test("lima game baru punya target kurasi yang sesuai kebutuhannya", () => {
  const expected = [
    // Ketiganya description-nya "Format no tujuan [UID]|[Server]", jadi pemisah
    // `|` — bukan `{user_id}{server_id}` yang menghilangkan pemisah.
    { id: "ragnarok-m-eternal-love", template: "{user_id}|{server_id}", server: true },
    { id: "honkai-star-rail", template: "{user_id}|{server_id}", server: true },
    { id: "heroes-evolved", template: "{user_id}|{server_id}", server: true },
    // Dua ini cuma minta ID.
    { id: "league-of-legends-pc", template: "{user_id}", server: false },
    { id: "teamfight-tactics-mobile", template: "{user_id}", server: false },
  ];

  for (const item of expected) {
    const target = getCuratedGameTarget(item.id);
    assert.ok(target, `${item.id} tidak ada di peta kurasi`);
    assert.equal(target.template, item.template, `${item.id} template salah`);
    assert.equal(target.requiresServer, item.server, `${item.id} requiresServer salah`);
  }
});

test("peta kurasi menandai mobile legends adventure", () => {
  // Kasus paling berbahaya sebelum migrasi: form-nya sudah benar (User ID +
  // Zone ID) tapi templatenya kosong, jadi order lolos validasi lalu gagal di
  // supplier.
  const target = getCuratedGameTarget("mobile-legends-adventure");
  assert.equal(target?.requiresServer, true);
  assert.equal(target?.template, "{user_id}{server_id}");
});

test("setiap game di peta kurasi punya template yang valid", () => {
  const allowed = new Set([
    "{user_id}",
    "{user_id}{server_id}",
    "{user_id}|{server_id}",
  ]);
  for (const [id, target] of Object.entries(CURATED_GAME_TARGETS)) {
    assert.ok(
      target.template === null || allowed.has(target.template),
      `${id} punya template "${target.template}" yang tidak dikenal`,
    );
    assert.equal(typeof target.requiresServer, "boolean", `${id} requiresServer bukan boolean`);

    // Template `{user_id}` saja dengan `requires_server` true tidak akan pernah
    // bisa dirender — `renderFulfillmentTarget` melempar error dan order gagal.
    // Ini kombinasi yang pernah membuat Genshin Impact dan Wuthering Waves
    // gagal di fulfillment, jadi dikunci di sini.
    if (target.requiresServer && target.template === "{user_id}") {
      assert.fail(`${id} requires_server true tapi template tidak punya {server_id}`);
    }
  }
});

test("game ber-server memakai pemisah yang cocok dengan description supplier", () => {
  // Kolom `description` di supplier_catalog_items:
  //   "Format no tujuan [UID]|[Server]"  -> pemisah `|`
  //   "Masukkan ID dan Server"             -> pemisah `|`
  //   "no tujuan = gabungan user_id dan zone_id" -> tanpa pemisah
  const pipe = [
    "genshin-impact",
    "wuthering-waves",
    "zenless-zone-zero",
    "honkai-star-rail",
    "heroes-evolved",
    "dragon-nest-m-classic",
    "ragnarok-m-eternal-love",
    "nba-infinite",
  ];
  for (const id of pipe) {
    assert.equal(
      getCuratedGameTarget(id)?.template,
      "{user_id}|{server_id}",
      `${id} harus memakai pemisah |`,
    );
  }

  const concat = ["mobile-legends", "mobile-legends-adventure", "magic-chess"];
  for (const id of concat) {
    assert.equal(
      getCuratedGameTarget(id)?.template,
      "{user_id}{server_id}",
      `${id} harus digabung tanpa pemisah`,
    );
  }
});

test("tidak ada game yang gagal total saat fulfillment", () => {
  // Regresi: Genshin Impact & Wuthering Waves punya requires_server true dengan
  // template `{user_id}`. `renderFulfillmentTarget` menolak kombinasi itu, jadi
  // setiap order kedua game itu gagal. Test ini menjalankan renderer sungguhan
  // terhadap kombinasi template di peta kurasi.
  for (const [id, target] of Object.entries(CURATED_GAME_TARGETS)) {
    if (!target.template || !target.requiresServer) continue;
    assert.doesNotThrow(
      () =>
        renderFulfillmentTarget(target.template as string, {
          userId: "123456789",
          serverId: "030003",
          requiresServer: true,
        }),
      `${id} tidak bisa dirender`,
    );
  }
});

test("pemisah | dipertahankan saat dirender", () => {
  // Contoh supplier Dragon Nest M: "Note : User ID|Server  Contoh :
  // 400628|030003". Nol di depan server harus utuh dan pemisah tidak hilang.
  assert.deepEqual(
    renderFulfillmentTarget("{user_id}|{server_id}", {
      userId: "400628",
      serverId: "030003",
      requiresServer: true,
    }),
    { customerNo: "400628|030003", allowDot: false },
  );

  // Tanpa pemisah, Mobile Legends tetap digabung: "no tujuan = gabungan antara
  // user_id dan zone_id".
  assert.deepEqual(
    renderFulfillmentTarget("{user_id}{server_id}", {
      userId: "123456789",
      serverId: "1234",
      requiresServer: true,
    }),
    { customerNo: "1234567891234", allowDot: false },
  );
});

test("dragon nest m: server berupa angka dan nol di depan harus utuh", () => {
  // Deskripsi Seller di panel Digiflazz:
  //   "Note : User ID|Server  Contoh : 400628|030003"
  // Nol di depan hilang kalau kolomnya menerima teks bebas lalu dirangkai, atau
  // kalau input-nya `type="number"`. Keduanya ditolak di sini.
  const game = {
    id: "dragon-nest-m-classic",
    name: "Dragon Nest M Classic",
    requiresServer: true,
  };
  const schema = getGameAccountSchema(game);

  assert.equal(schema.server?.sanitize, "digits", "sanitize harus digits");
  assert.equal(schema.server?.placeholder, "Contoh: 030003");

  assert.ok(
    validateGameAccountTarget(game, "400628", "030003").ok,
    "contoh supplier ditolak",
  );
  // Nomor channel akan bertambah terus; 7 digit harus tetap diterima.
  assert.ok(validateGameAccountTarget(game, "400628", "1234567").ok);
  // Teks bebas tidak boleh: nama channel akan lolos validasi lalu ditolak
  // supplier setelah dibayar.
  assert.equal(
    validateGameAccountTarget(game, "400628", "Argenta").ok,
    false,
    "nama channel lolos",
  );
  assert.equal(
    validateGameAccountTarget(game, "400628", "0300034").ok,
    true,
    "nol di depan tidak boleh di-strip",
  );
});

test("nba infinite: dropdown lima wilayah, heroes evolved: dropdown lima wilayah", () => {
  const nba = getGameAccountSchema({
    id: "nba-infinite",
    name: "NBA Infinite",
    requiresServer: true,
  });
  assert.deepEqual(nba.server?.options, ["Asia", "Europe", "NA", "LATAM", "Oceania"]);

  const heroes = getGameAccountSchema({
    id: "heroes-evolved",
    name: "Heroes Evolved",
    requiresServer: true,
  });
  assert.deepEqual(heroes.server?.options, ["Asia", "SEA", "NA", "SA", "EU"]);

  // Keduanya harus punya dropdown lima wilayah.
  assert.ok(nba.server?.options && heroes.server?.options);
  assert.ok(
    validateGameAccountTarget(
      { id: "nba-infinite", name: "NBA Infinite", requiresServer: true },
      "123456",
      "Oceania",
    ).ok,
  );
  assert.equal(
    validateGameAccountTarget(
      { id: "heroes-evolved", name: "Heroes Evolved", requiresServer: true },
      "123456",
      "Europe",
    ).ok,
    false,
    "server di luar daftar dropdown lolos",
  );
});

test("gamesMissingCuratedTarget menandai game yang belum diverifikasi", () => {
  const missing = gamesMissingCuratedTarget([
    "free-fire",
    "game-yang-tidak-dikenal",
    "ragnarok-m-eternal-love",
  ]);
  assert.deepEqual(missing, ["game-yang-tidak-dikenal"]);
  assert.equal(gamesMissingCuratedTarget([]).length, 0);
});