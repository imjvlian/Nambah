import assert from "node:assert/strict";
import test from "node:test";
import {
  getGameAccountSchema,
  validateGameAccountTarget,
} from "../src/lib/game-account.ts";

test("mobile legends: dua kolom, user 5-12 digit + zone 3-5 digit", () => {
  const schema = getGameAccountSchema({
    id: "mobile-legends",
    name: "Mobile Legends",
    requiresServer: true,
  });
  assert.equal(schema.kind, "mobile-legends");
  assert.ok(schema.server);

  assert.deepEqual(
    validateGameAccountTarget(
      { id: "mobile-legends", name: "Mobile Legends", requiresServer: true },
      "123456789",
      "2685",
    ),
    { ok: true, userId: "123456789", serverId: "2685" },
  );

  const tanpaZone = validateGameAccountTarget(
    { id: "mobile-legends", name: "Mobile Legends", requiresServer: true },
    "123456789",
    "",
  );
  assert.equal(tanpaZone.ok, false);
});

test("free fire / pubg / hok: satu kolom player id numerik", () => {
  for (const game of [
    { id: "free-fire", name: "Free Fire" },
    { id: "pubg-mobile", name: "PUBG Mobile" },
    { id: "honor-of-kings", name: "Honor of Kings" },
  ]) {
    const schema = getGameAccountSchema(game);
    assert.equal(schema.kind, "numeric-player");
    assert.equal(schema.server, undefined);

    assert.deepEqual(validateGameAccountTarget(game, "512345678"), {
      ok: true,
      userId: "512345678",
    });

    const huruf = validateGameAccountTarget(game, "abcdef");
    assert.equal(huruf.ok, false);
  }
});

test("valorant: satu kolom Riot ID dengan # wajib", () => {
  const game = { id: "valorant", name: "Valorant" };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "valorant");
  assert.equal(schema.server, undefined);

  assert.deepEqual(validateGameAccountTarget(game, "Joko#1234"), {
    ok: true,
    userId: "Joko#1234",
  });

  const tanpaTag = validateGameAccountTarget(game, "Joko");
  assert.equal(tanpaTag.ok, false);
});

test("genshin: dua kolom, server memakai kode internal 4 region resmi", () => {
  const game = { id: "genshin-impact", name: "Genshin Impact", requiresServer: true };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "genshin");
  // Deskripsi Seller di panel Digiflazz: "Asia,os_asia,...; America,os_usa,002;
  // Europe,os_euro,003; TW, HK, MO,os_cht,004". Yang dikirim ke supplier adalah
  // kode `os_*`, bukan nama region.
  assert.deepEqual(schema.server?.options, [
    { value: "os_asia", label: "Asia (os_asia)" },
    { value: "os_usa", label: "America (os_usa)" },
    { value: "os_euro", label: "Europe (os_euro)" },
    { value: "os_cht", label: "TW / HK / MO (os_cht)" },
  ]);

  assert.deepEqual(validateGameAccountTarget(game, "812345678", "os_asia"), {
    ok: true,
    userId: "812345678",
    serverId: "os_asia",
  });

  for (const invalid of ["Asia", "asia", "ASIA", "os_Asia", "asia tenggara", ""]) {
    const result = validateGameAccountTarget(game, "812345678", invalid);
    assert.equal(result.ok, false, `server '${invalid}' harus ditolak`);
  }
});

test("roblox: satu kolom username", () => {
  const game = { id: "roblox", name: "Roblox" };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "roblox");
  assert.equal(schema.server, undefined);

  assert.deepEqual(validateGameAccountTarget(game, "Builderman_01"), {
    ok: true,
    userId: "Builderman_01",
  });
});

test("wuthering waves: dua kolom, server hanya 5 region resmi", () => {
  const game = {
    id: "wuthering-waves",
    name: "Wuthering Waves",
    requiresServer: true,
  };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "wuthering-waves");
  assert.deepEqual(schema.server?.options, ["America", "Europe", "Asia", "SEA", "HMT"]);

  assert.deepEqual(validateGameAccountTarget(game, "700123456", "SEA"), {
    ok: true,
    userId: "700123456",
    serverId: "SEA",
  });

  const serverNgawur = validateGameAccountTarget(game, "700123456", "sea-1");
  assert.equal(serverNgawur.ok, false);
});

test("pulsa & e-money: satu kolom nomor HP 08, huruf ditolak", () => {
  for (const game of [
    { id: "telkomsel", name: "Telkomsel" },
    { id: "xl", name: "XL" },
    { id: "dana", name: "DANA" },
    { id: "go-pay", name: "GoPay" },
    { id: "shopee-pay", name: "ShopeePay" },
  ]) {
    const schema = getGameAccountSchema(game);
    assert.equal(schema.kind, "phone", `${game.id} harus memakai skema phone`);
    assert.equal(schema.server, undefined);

    assert.deepEqual(validateGameAccountTarget(game, "0812 3456 7890"), {
      ok: true,
      userId: "081234567890",
    });

    const bukanHp = validateGameAccountTarget(game, "userabc");
    assert.equal(bukanHp.ok, false, `${game.id} harus menolak non-HP`);
  }
});

test("tagihan (PLN dsb.): satu kolom nomor pelanggan numerik", () => {
  const game = { id: "pln", name: "PLN" };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "numeric-bill");
  assert.equal(schema.server, undefined);

  assert.deepEqual(validateGameAccountTarget(game, "521234567890"), {
    ok: true,
    userId: "521234567890",
  });

  const huruf = validateGameAccountTarget(game, "pelanggan1");
  assert.equal(huruf.ok, false);
});

test("wild rift & runeterra: satu kolom Riot ID seperti valorant", () => {
  for (const game of [
    { id: "league-of-legends-wild-rift", name: "League Of Legends Wild Rift" },
    { id: "legends-of-runeterra", name: "Legends Of Runeterra" },
  ]) {
    const schema = getGameAccountSchema(game);
    assert.equal(schema.kind, "valorant", `${game.id} harus memakai skema Riot ID`);

    assert.deepEqual(validateGameAccountTarget(game, "Joko#1234"), {
      ok: true,
      userId: "Joko#1234",
    });

    const tanpaTag = validateGameAccountTarget(game, "Joko");
    assert.equal(tanpaTag.ok, false, `${game.id} harus menolak Riot ID tanpa tag`);
  }
});

test("aov / delta force / fc mobile / marvel rivals / aniimo / ff max: player id numerik", () => {
  for (const game of [
    { id: "arena-of-valor", name: "Arena Of Valor" },
    { id: "delta-force", name: "Delta Force" },
    { id: "fc-mobile", name: "FC Mobile" },
    { id: "marvel-rivals", name: "Marvel Rivals" },
    { id: "aniimo", name: "Aniimo" },
    { id: "free-fire-max", name: "Free Fire Max" },
  ]) {
    const schema = getGameAccountSchema(game);
    assert.equal(schema.kind, "numeric-player", `${game.id} harus memakai skema numeric-player`);

    assert.deepEqual(validateGameAccountTarget(game, "512345678"), {
      ok: true,
      userId: "512345678",
    });

    const huruf = validateGameAccountTarget(game, "abcdef");
    assert.equal(huruf.ok, false, `${game.id} harus menolak non-numerik`);
  }
});

test("point blank: user id alfanumerik, bukan murni numerik", () => {
  const game = { id: "point-blank", name: "Point Blank" };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "alphanumeric-player");

  assert.deepEqual(validateGameAccountTarget(game, "Zepetto_01"), {
    ok: true,
    userId: "Zepetto_01",
  });
  assert.deepEqual(validateGameAccountTarget(game, "12345678"), {
    ok: true,
    userId: "12345678",
  });

  const terlaluPendek = validateGameAccountTarget(game, "ab");
  assert.equal(terlaluPendek.ok, false);
});

test("voucher kode redeem (steam, google play, psn, garena, efootball): email atau no HP", () => {
  for (const game of [
    { id: "steam-wallet", name: "Steam Wallet" },
    { id: "steam-wallet-idr", name: "Steam Wallet (IDR)" },
    { id: "google-play-indonesia", name: "Google Play Indonesia" },
    { id: "playstation", name: "Playstation" },
    { id: "garena", name: "Garena" },
    { id: "efootball", name: "Efootball" },
  ]) {
    const schema = getGameAccountSchema(game);
    assert.equal(schema.kind, "contact", `${game.id} harus memakai skema contact`);

    assert.deepEqual(validateGameAccountTarget(game, "nama@email.com"), {
      ok: true,
      userId: "nama@email.com",
    });
    assert.deepEqual(validateGameAccountTarget(game, "081234567890"), {
      ok: true,
      userId: "081234567890",
    });

    const ngawur = validateGameAccountTarget(game, "bukan-email");
    assert.equal(ngawur.ok, false, `${game.id} harus menolak input bukan email/HP`);
  }
});

test("game tidak dikenal: skema generic longgar tapi tetap tervalidasi", () => {
  const game = { id: "game-baru", name: "Game Baru" };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "generic");

  const kosong = validateGameAccountTarget(game, "");
  assert.equal(kosong.ok, false);
});
