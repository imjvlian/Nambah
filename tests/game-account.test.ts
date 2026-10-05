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

test("genshin: dua kolom, server hanya boleh 4 region resmi", () => {
  const game = { id: "genshin-impact", name: "Genshin Impact", requiresServer: true };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "genshin");
  assert.deepEqual(schema.server?.options, ["Asia", "America", "Europe", "TW/HK/MO"]);

  assert.deepEqual(validateGameAccountTarget(game, "812345678", "Asia"), {
    ok: true,
    userId: "812345678",
    serverId: "Asia",
  });

  for (const invalid of ["asia", "ASIA", "asia tenggara", ""]) {
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

test("game tidak dikenal: skema generic longgar tapi tetap tervalidasi", () => {
  const game = { id: "game-baru", name: "Game Baru" };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.kind, "generic");

  const kosong = validateGameAccountTarget(game, "");
  assert.equal(kosong.ok, false);
});
