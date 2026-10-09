import assert from "node:assert/strict";
import test from "node:test";

import {
  gameDisplayName,
  gameDisplayNames,
} from "../src/lib/game-display-name.ts";

/**
 * Nama tampilan game.
 *
 * Aturan yang dijaga test ini: id game TIDAK BOLEH muncul di tempat pengguna
 * membacanya. Semua jalur yang mengambil nama game harus lewat
 * `gameDisplayName` / `gameDisplayNames`, sehingga override ini berlaku
 * seragam di storefront, panel admin, dan pesan Telegram.
 */

test("LifeAfter ditampilkan sebagai LifeAfter", () => {
  // Nama di database masih "Lifeafter Credits" — itu output `catalog-sync`
  // dari brand Digiflazz, dan tidak diubah di sana.
  const databaseNames = { name: "Lifeafter Credits", shortName: "Lifeafter Credits" };

  assert.deepEqual(gameDisplayNames("lifeafter-credits", databaseNames), {
    name: "LifeAfter",
    shortName: "LifeAfter",
  });
  assert.equal(gameDisplayName("lifeafter-credits", "Lifeafter Credits"), "LifeAfter");
});

test("game tanpa override memakai nama dari database", () => {
  // Override hanya untuk game yang perlu. Semua game lain harus tidak
  // tersentuh — kalau helper ini salah, SELURUH katalog ikut berubah.
  const databaseNames = { name: "Mobile Legends", shortName: "MLBB" };
  assert.deepEqual(gameDisplayNames("mobile-legends", databaseNames), databaseNames);
  assert.equal(gameDisplayName("valorant", "Valorant"), "Valorant");
  assert.equal(gameDisplayName("heroevolved", "Heroes Evolved"), "Heroes Evolved");
});

test("id game tidak pernah dikembalikan sebagai nama", () => {
  // Fallback terakhir harus tetap berupa nama. Kalau `gameDisplayName` menerima
  // id sebagai nama database — seperti di `daily-digest`, yang belum tahu nama
  // game-nya — hasilnya harus tetap bisa dibaca, bukan slug.
  const known = gameDisplayName("lifeafter-credits", "lifeafter-credits");
  assert.equal(known, "LifeAfter", "id tidak boleh bocor ke tampilan");

  // Untuk game yang tidak punya override, input kedua diteruskan apa adanya.
  // Itu perilaku yang benar: kalau nilainya memang nama, ditampilkan; kalau
  // memang id, itu kondisi yang tidak boleh terjadi di jalur mana pun.
  const unknown = gameDisplayName("some-unknown-game", "some-unknown-game");
  assert.equal(unknown, "some-unknown-game");
});

test("override tidak pernah mengembalikan undefined", () => {
  // Kalau helper mengembalikan `undefined`, pemanggil yang pakai `?? game.id`
  // akan diam-diam membocorkan id. Kunci override selalu mengembalikan objek
  // lengkap, dan tanpa override memakai input.
  for (const [id, db] of [
    ["lifeafter-credits", { name: "Lifeafter Credits", shortName: "Lifeafter Credits" }],
    ["valorant", { name: "Valorant", shortName: "Valorant" }],
  ] as const) {
    const result = gameDisplayNames(id, db);
    assert.ok(result.name, `${id}.name undefined`);
    assert.ok(result.shortName, `${id}.shortName undefined`);
  }
});

test("kunci override adalah game.id, bukan brand Digiflazz", () => {
  // Dua nilai ini berbeda untuk LifeAfter dan tidak boleh tertukar.
  // `games.id` = "lifeafter-credits", brand = "LifeAfter Credits".
  assert.equal(gameDisplayName("lifeafter-credits", "X"), "LifeAfter");
  assert.equal(
    gameDisplayName("lifeafter credits", "X"),
    "X",
    "brand Digiflazz bukan kunci yang valid",
  );
  assert.equal(
    gameDisplayName("lifeafter", "X"),
    "X",
    "id yang disederhanakan bukan kunci yang valid — akan memicu duplikat",
  );
});
