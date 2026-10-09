import assert from "node:assert/strict";
import test from "node:test";
import {
  accountFieldOptionLabel,
  accountFieldOptionValue,
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
  // Ejaan mengikuti situs resmi: "Memory of Faith" dengan huruf kecil pada
  // "of". Nilai inilah yang dikirim ke supplier.
  assert.deepEqual(schema.server?.options, [
    "Eternal Love",
    "Midnight Party",
    "Memory of Faith",
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

test("tiga game HoYoverse kirim kode internal, bukan nama region", () => {
  // Deskripsi Seller di panel Digiflazz (produk ZZZ, seller MA***):
  //   "Format order : UID|Server uid,server uid|server uid(server)
  //    uid (default asia) List Server :
  //    Asia,os_asia,prod_official,asia,001
  //    America,os_usa,002
  //    Europe,os_euro,003
  //    TW, HK, MO,os_cht,004"
  //
  // Ketiganya publisher HoYoverse dan memakai daftar server yang sama.
  const expected = ["os_asia", "os_usa", "os_euro", "os_cht"];
  for (const [id, name] of [
    ["genshin-impact", "Genshin Impact"],
    ["honkai-star-rail", "Honkai: Star Rail"],
    ["zenless-zone-zero", "Zenless Zone Zero"],
  ] as const) {
    const schema = getGameAccountSchema({ id, name, requiresServer: true });
    assert.deepEqual(
      schema.server?.options.map(accountFieldOptionValue),
      expected,
      `${id} salah daftar server`,
    );
    // Label harus menyebut nama region agar pelanggan tidak melihat kode telanjang.
    assert.deepEqual(schema.server?.options.map(accountFieldOptionLabel), [
      "Asia (os_asia)",
      "America (os_usa)",
      "Europe (os_euro)",
      "TW / HK / MO (os_cht)",
    ]);

    assert.ok(validateGameAccountTarget({ id, name, requiresServer: true }, "123456789", "os_asia").ok);
    // Nama region tidak lagi diterima — kode adalah yang dikirim ke supplier.
    assert.equal(
      validateGameAccountTarget({ id, name, requiresServer: true }, "123456789", "Asia").ok,
      false,
      `nama region lolos untuk ${id}`,
    );
  }

  // Hasil render harus persis "UID|Server" dari Deskripsi Seller.
  assert.equal(
    renderFulfillmentTarget("{user_id}|{server_id}", {
      userId: "12345",
      serverId: "os_asia",
      requiresServer: true,
    }).customerNo,
    "12345|os_asia",
  );
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

  // Server adalah kode angka dari daftar server NetDragon, bukan nama region.
  assert.ok(validateGameAccountTarget(game, "123456", "131").ok);
  assert.equal(validateGameAccountTarget(game, "abc", "131").ok, false);
  assert.equal(validateGameAccountTarget(game, "123456", "").ok, false);
  assert.equal(
    validateGameAccountTarget(game, "123456", "1").ok,
    false,
    "kode server di luar daftar lolos",
  );
  assert.equal(
    validateGameAccountTarget(game, "123456", "SEA").ok,
    false,
    "nama region lolos",
  );
});

test("lima game baru punya target kurasi yang sesuai kebutuhannya", () => {
  const expected = [
    // Ragnarok M & HSR: pemisah `|` (HSR terbukti dari "Contoh : 12345|os_asia").
    { id: "ragnarok-m-eternal-love", template: "{user_id}|{server_id}", server: true },
    { id: "honkai-star-rail", template: "{user_id}|{server_id}", server: true },
    // Heroes Evolved: pemisah PIPE. Deskripsi Produk-nya
    // `Format no tujuan [UID]|[Server]`, sama dengan LifeAfter.
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
    "{user_id},{server_id}",
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

test("game ber-server memakai pemisah yang sesuai format supplier", () => {
  // Dua gaya Deskripsi Produk di Digiflazz, dan keduanya punya arti berbeda:
  //
  //   "no tujuan = gabungan user id dan zone id"   -> TANPA pemisah (disambung)
  //   "Format no tujuan [UID]|[Server]"            -> pemisah PIPE
  //
  // Yang menyebut kata "gabung" memang bermaksud disambung. Yang memakai
  // notasi kurung siku dengan tanda pisah di dalamnya bermaksud dipisah.
  // Kalau maksudnya disambung, seller akan menulis "gabung" seperti Mobile
  // Legends dan Mobile Legends Adventure lakukan.
  //
  // Bukti literal untuk pipe: LifeAfter, seller menulis di panel
  // "FORMAT : USER ID|SERVER contoh 123456|500001".
  //
  // Pemisah KOMA sekarang hanya NBA Infinite, dari tabel reseller
  // ("Contoh : 12345,1001"). Heroes Evolved pindah dari koma ke pipe pada
  // 2026-10-09: kolom Deskripsi Produk-nya `Format no tujuan [UID]|[Server]`,
  // sama persis dengan LifeAfter, dan sumber reseller pihak ketiga tidak
  // mengalahkan kolom milik Digiflazz sendiri.
  const pipe = [
    "genshin-impact",
    "wuthering-waves",
    "zenless-zone-zero",
    "honkai-star-rail",
    "dragon-nest-m-classic",
    "ragnarok-m-eternal-love",
    "lifeafter-credits",
    "heroes-evolved",
  ];
  for (const id of pipe) {
    assert.equal(
      getCuratedGameTarget(id)?.template,
      "{user_id}|{server_id}",
      `${id} harus memakai pemisah |`,
    );
  }

  const comma = ["nba-infinite"];
  for (const id of comma) {
    assert.equal(
      getCuratedGameTarget(id)?.template,
      "{user_id},{server_id}",
      `${id} harus memakai pemisah koma`,
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

test("Deskripsi Seller mengalahkan Deskripsi Produk", () => {
  // Regresi dari koreksi 2026-10-09.
  //
  // One Punch Man punya Deskripsi Produk `Format no tujuan [UID]|[Server]` —
  // string yang PERSIS sama dengan LifeAfter dan Honkai Star Rail, yang
  // keduanya memang butuh server. Tapi Deskripsi Seller-nya menyatakan
  // "Tujuan = ID saja salah otomatis gagal", jadi game ini TIDAK butuh
  // server.
  //
  // Jadi kolom Deskripsi Produk bisa jadi boilerplate. Kalau aturan ini
  // dilanggar, notasi kurung siku akan diperlakukan sebagai "pemisah berarti
  // server opsional" dan game ini akan salah mengirim `uid|server`.
  for (const id of ["one-punch-man", "tom-and-jerry-chase"]) {
    const target = getCuratedGameTarget(id);
    assert.equal(target?.requiresServer, false, `${id} tidak butuh server`);
    assert.equal(target?.template, "{user_id}", `${id} template harus {user_id}`);
  }
});

test("tidak ada game yang gagal total saat fulfillment", () => {
  // Regresi: Genshin Impact & Wuthering Waves punya requires_server true dengan
  // template `{user_id}`. `renderFulfillmentTarget` menolak kombinasi itu, jadi
  // setiap order kedua game itu gagal. Test ini menjalankan renderer sungguhan
  // terhadap kombinasi template di peta kurasi.
  // Server diuji dengan nilai yang BENAR-BENAR bisa dipilih untuk game itu, bukan
  // satu angka generik: Heroes Evolved pakai kode 3 digit (100), NBA Infinite
  // kode 4 digit (1001), HSR kode `os_*`. Memakai `030003` untuk semuanya akan
  // menutupi bug di nilai yang sebenarnya dipakai.
  const sampleByGame: Record<string, string> = {
    "heroes-evolved": "131",
    "nba-infinite": "1001",
    "honkai-star-rail": "os_asia",
    "ragnarok-m-eternal-love": "Eternal Love",
    "dragon-nest-m-classic": "030003",
    "mobile-legends": "1234",
    "mobile-legends-adventure": "1234",
    "magic-chess": "1234",
    "genshin-impact": "os_cht",
    "zenless-zone-zero": "os_cht",
    "honkai-star-rail": "os_cht",
    "wuthering-waves": "HMT",
    // Katalog baru (2026-10-09). LifeAfter mengirim KODE server enam digit
    // (`123456|500001`), bukan nama server — nama Mandarin-nya tidak akan
    // melewati filter karakter `customer_no` kalau tidak diterjemahkan ke kode.
    "lifeafter-credits": "500001",
    "one-punch-man": "123456",
    // Tom and Jerry: server berupa NAMA ("Asia"), pemisah koma.
    "tom-and-jerry-chase": "Asia",
  };
  for (const [id, target] of Object.entries(CURATED_GAME_TARGETS)) {
    if (!target.template || !target.requiresServer) continue;
    assert.doesNotThrow(
      () =>
        renderFulfillmentTarget(target.template as string, {
          userId: "123456789",
          serverId: sampleByGame[id],
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

test("nba infinite & heroes evolved mengirim kode angka, bukan nama region", () => {
  // Tabel format reseller Digiflazz:
  //   NBA Infinite:   1001=Oceania 5001=SouthAmerica 6001=NA 7001=Asia 8001=Europe
  //   Heroes Evolved: 100/101=NA 111/112=EU 121/122=SA 131/132/133/134/135=AS
  //
  // Pemisah KOMA, bukan pipe: "Format tujuan : User ID,Server".
  const nba = getGameAccountSchema({
    id: "nba-infinite",
    name: "NBA Infinite",
    requiresServer: true,
  });
  assert.deepEqual(nba.server?.options.map(accountFieldOptionValue), [
    "1001",
    "5001",
    "6001",
    "7001",
    "8001",
  ]);
  // Label harus informatif — pelanggan tidak boleh melihat `7001` tanpa nama.
  assert.deepEqual(
    nba.server?.options.map(accountFieldOptionLabel),
    ["Oceania (1001)", "South America / LATAM (5001)", "North America (6001)", "Asia (7001)", "Europe (8001)"],
  );

  const heroes = getGameAccountSchema({
    id: "heroes-evolved",
    name: "Heroes Evolved",
    requiresServer: true,
  });
  assert.deepEqual(heroes.server?.options.map(accountFieldOptionValue), [
    "100",
    "101",
    "111",
    "112",
    "121",
    "122",
    "131",
    "132",
    "133",
    "134",
    "135",
  ]);

  // Nama region yang lama harus DITOLAK, bukan lolos validasi lalu gagal di
  // supplier. Ini yang membuat daftar lama berbahaya: "Asia" adalah format yang
  // masuk akal tapi salah.
  for (const [game, server] of [
    [{ id: "nba-infinite", name: "NBA Infinite", requiresServer: true }, "Asia"],
    [{ id: "heroes-evolved", name: "Heroes Evolved", requiresServer: true }, "SEA"],
  ] as const) {
    assert.equal(
      validateGameAccountTarget(game, "123456", server).ok,
      false,
      `nama region "${server}" lolos`,
    );
  }

  assert.ok(
    validateGameAccountTarget(
      { id: "nba-infinite", name: "NBA Infinite", requiresServer: true },
      "123456",
      "1001",
    ).ok,
  );
  assert.ok(
    validateGameAccountTarget(
      { id: "heroes-evolved", name: "Heroes Evolved", requiresServer: true },
      "123456",
      "131",
    ).ok,
  );

  // Render harus persis "Contoh : 12345,1001" dari tabel reseller.
  assert.equal(
    renderFulfillmentTarget("{user_id},{server_id}", {
      userId: "12345",
      serverId: "1001",
      requiresServer: true,
    }).customerNo,
    "12345,1001",
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