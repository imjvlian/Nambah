import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VOLSEVER_ROUTES,
  UNKNOWN_VOLSEVER_ROUTES,
  gamesWithVolseverRoute,
  parseVolseverRoutesEnv,
  resolveVolseverRoute,
} from "../src/lib/volsever/games.ts";

test("parseVolseverRoutesEnv: menerima JSON dan menolak nilai rusak", () => {
  assert.deepEqual(parseVolseverRoutesEnv('{"a":"b"}'), { a: "b" });
  assert.deepEqual(parseVolseverRoutesEnv("  \n"), null);
  assert.deepEqual(parseVolseverRoutesEnv(undefined), null);

  // Nilai rusak harus jadi `null`, bukan exception: mapping yang salah tidak
  // boleh menjatuhkan halaman checkout.
  assert.equal(parseVolseverRoutesEnv("{bukan json"), null);
  assert.equal(parseVolseverRoutesEnv("[]"), null);
  assert.equal(parseVolseverRoutesEnv('"string"'), null);
});

test("resolveVolseverRoute: peta bawaan dipakai saat env kosong", () => {
  // Inilah kondisi produksi saat ini: `VOLSEVER_GAME_ROUTES_JSON` kosong.
  assert.equal(resolveVolseverRoute("genshin-impact", null), "genshin-impact");
  assert.equal(
    resolveVolseverRoute("call-of-duty-mobile", null),
    "call-of-duty-mobile-indonesia",
  );
  assert.equal(
    resolveVolseverRoute("fc-mobile", null),
    "ea-sports-fc-mobile-indonesia",
  );
  assert.equal(
    resolveVolseverRoute("magic-chess", null),
    "magic-chess-go-go",
  );
});

test("resolveVolseverRoute: game tanpa mapping mengembalikan null", () => {
  // Free Fire adalah game terbesar di katalog tapi tidak ada slug Volsever.
  assert.equal(resolveVolseverRoute("free-fire", null), null);
  assert.equal(resolveVolseverRoute("dragon-nest-m-classic", null), null);
  assert.equal(resolveVolseverRoute("tidak-ada", null), null);
});

test("resolveVolseverRoute: env menimpa peta bawaan", () => {
  assert.equal(
    resolveVolseverRoute("genshin-impact", { "genshin-impact": "genshin-impact-cd" }),
    "genshin-impact-cd",
  );
  // Env bisa menambah game yang tidak ada di peta bawaan.
  assert.equal(
    resolveVolseverRoute("free-fire", { "free-fire": "free-fire-indonesia" }),
    "free-fire-indonesia",
  );
});

test("resolveVolseverRoute: slug dari env divalidasi", () => {
  // Path traversal dan karakter aneh harus ditolak supaya tidak dipakai
  // sebagai bagian dari URL Volsever.
  assert.equal(
    resolveVolseverRoute("game", { game: "../../admin" }),
    null,
  );
  assert.equal(resolveVolseverRoute("game", { game: "a b" }), null);
  assert.equal(resolveVolseverRoute("game", { game: 123 }), null);
  assert.equal(resolveVolseverRoute("game", { game: "  " }), null);
});

test("route yang gagal di sisi Volsever tidak ikut dipetakan", () => {
  // state-of-survival dan nba-infinite tercatat `fail` di health check
  // Volsever. Kalau ikut dipetakan, pelanggan hanya melihat error.
  for (const gameId of UNKNOWN_VOLSEVER_ROUTES) {
    assert.equal(
      resolveVolseverRoute(gameId, null),
      null,
      `${gameId} tidak boleh punya route default`,
    );
    assert.ok(
      !(gameId in DEFAULT_VOLSEVER_ROUTES),
      `${gameId} tidak boleh ada di DEFAULT_VOLSEVER_ROUTES`,
    );
  }
});

test("semua slug bawaan punya bentuk yang diizinkan client Volsever", () => {
  // `volsever/client.ts` menolak slug di luar pola ini sebelum fetch.
  for (const [gameId, slug] of Object.entries(DEFAULT_VOLSEVER_ROUTES)) {
    assert.match(
      slug,
      /^[a-z0-9-]+$/i,
      `slug untuk ${gameId} tidak lolos validasi client`,
    );
    assert.ok(gameId.length > 0);
  }
});

test("gamesWithVolseverRoute: menggabungkan bawaan dan env tanpa duplikat", () => {
  const base = gamesWithVolseverRoute(null);
  assert.equal(base.length, Object.keys(DEFAULT_VOLSEVER_ROUTES).length);
  assert.deepEqual(base, [...base].sort(), "hasil harus terurut");

  const merged = gamesWithVolseverRoute({ "free-fire": "free-fire", "zzz": "bad slug" });
  assert.ok(merged.includes("free-fire"), "game dari env harus masuk");
  assert.ok(!merged.includes("zzz"), "slug invalid harus dibuang");
  assert.equal(merged.length, base.length + 1);
});