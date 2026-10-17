import assert from "node:assert/strict";
import test from "node:test";
import {
  MELOSTORE_GAME_CODES,
  RESIDUAL_UNVERIFIABLE_GAMES,
  getMelostoreGameCode,
  isResidualUnverifiableGame,
  melostoreCodeRequiresZone,
} from "../src/lib/melostore-game-codes.ts";

test("semua code melostore adalah slug yang sehat", () => {
  for (const [gameId, code] of Object.entries(MELOSTORE_GAME_CODES)) {
    assert.match(gameId, /^[a-z0-9-]+$/, `game id: ${gameId}`);
    assert.match(code, /^[a-z0-9-]+$/, `code untuk ${gameId}: ${code}`);
  }
});

test("lima game residual persis seperti keputusan owner 17 Okt 2026", () => {
  assert.deepEqual([...RESIDUAL_UNVERIFIABLE_GAMES].sort(), [
    "aniimo",
    "free-fire-max",
    "lords-mobile",
    "roblox",
    "werewolf-party-game",
  ].sort());
});

test("game residual tidak pernah punya code — fail-open by design", () => {
  for (const id of RESIDUAL_UNVERIFIABLE_GAMES) {
    assert.equal(getMelostoreGameCode(id), null, id);
    assert.equal(isResidualUnverifiableGame(id), true, id);
  }
});

test("pemetaan yang krusial benar", () => {
  assert.equal(getMelostoreGameCode("mobile-legends"), "mobile-legends");
  assert.equal(getMelostoreGameCode("magic-chess"), "magic-chess-go-go");
  assert.equal(
    getMelostoreGameCode("league-of-legends-pc"),
    "league-of-legends",
  );
  assert.equal(
    getMelostoreGameCode("fc-mobile"),
    "ea-sports-fc-mobile-indonesia",
  );
  assert.equal(getMelostoreGameCode("valorant"), "valorant-indonesia");
  // Tidak terpetakan -> fail-open + alarm readiness, bukan error.
  assert.equal(getMelostoreGameCode("efootball"), null);
  assert.equal(getMelostoreGameCode("steam-wallet"), null);
  assert.equal(getMelostoreGameCode("pln"), null);
});

test("game yang menuntut zone tercatat dari data Melostore", () => {
  assert.equal(melostoreCodeRequiresZone("mobile-legends"), true);
  assert.equal(melostoreCodeRequiresZone("genshin-impact"), true);
  assert.equal(melostoreCodeRequiresZone("valorant-indonesia"), true);
  assert.equal(melostoreCodeRequiresZone("free-fire"), false);
  assert.equal(melostoreCodeRequiresZone("league-of-legends"), false);
});
