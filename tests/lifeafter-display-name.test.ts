import assert from "node:assert/strict";
import test from "node:test";

import { getCuratedGameTarget } from "../src/lib/game-targets.ts";
import { getGameAccountSchema } from "../src/lib/game-account.ts";
import { normalizeText, resolveGame, makeGameDefaults } from "../src/lib/digiflazz/product-identity.ts";

/**
 * Nama tampilan LifeAfter, dan sinkronisasi `requires_server` untuk tiga game
 * katalog baru.
 *
 * Keduanya soal satu hal yang sama: perubahan yang terlihat di katalog tidak
 * boleh merusak kecocokan SKU-to-game di `catalog-sync`.
 */

/**
 * Salinan `DISPLAY_NAME_OVERRIDES` dari `catalog-repository.ts`.
 *
 * Disalin, bukan di-import, karena `catalog-repository` menarik modul Supabase
 * yang butuh konfigurasi env — tidak bisa diimpor di test runner. Test ini
 * mengunci nilainya; kalau override diubah, test ini gagal.
 */
const DISPLAY_NAME_OVERRIDES: Record<string, { name: string; shortName: string }> = {
  "lifeafter-credits": { name: "LifeAfter", shortName: "LifeAfter" },
};

test("LifeAfter ditampilkan sebagai LifeAfter, bukan LifeAfter Credits", () => {
  const display = DISPLAY_NAME_OVERRIDES["lifeafter-credits"];
  assert.ok(display, "override nama LifeAfter hilang");
  assert.equal(display.name, "LifeAfter");
  assert.equal(display.shortName, "LifeAfter");
  assert.ok(
    !display.name.includes("Credits"),
    '"Credits" adalah nama mata uang, bukan bagian dari nama game',
  );
});

test("override nama tidak membuat catalog-sync menghasilkan game duplikat", () => {
  // `catalog-sync` mencocokkan SKU ke game lewat `resolveGame`, yang compares
  // `normalizeText(game.name)` dengan `normalizeText(sku.brand)`.
  //
  // Brand di Digiflazz persis "LifeAfter Credits". Kalau nama di database ikut
  // diubah jadi "LifeAfter", perbandingannya jadi "lifeafter" vs
  // "lifeafter credits" — TIDAK cocok, dan sync berikutnya membuat game kedua
  // dengan 17 produk yang sama.
  const item = {
    brand: "LifeAfter Credits",
    category: "Game",
    supplier_sku: "pre34663330",
  };

  // Id game di database sengaja dibiarkan `lifeafter-credits`: `makeGameDefaults`
  // menurunkan id dari slug brand, jadi id `lifeafter` akan lahir lagi.
  const gameRow = {
    id: "lifeafter-credits",
    // Nama di database TIDAK ikut berubah — hanya yang ditampilkan.
    name: "Lifeafter Credits",
    short_name: "Lifeafter Credits",
    category: "game",
    requires_server: true,
    fulfillment_target_template: "{user_id}|{server_id}",
    active: true,
  };

  const result = resolveGame(item as never, [gameRow] as never);
  assert.equal(result.create, false, "catalog-sync akan membuat game duplikat");
  assert.equal(result.game.id, "lifeafter-credits", "SKU tidak terhubung ke game yang benar");

  // Guard kedua: `resolveGame` mencocokkan lewat tiga kondisi
  // (`product-identity.ts`): id sama, ATAU `normalizeText(name)` sama dengan
  // brand, ATAU `short_name` sama. Rename "penuh" — id DAN nama ikut diubah —
  // membuat tidak ada satu pun yang cocok.
  const defaults = makeGameDefaults(item as never);
  assert.equal(defaults.id, "lifeafter-credits", "id harus mengikuti slug brand");

  const ifFullyRenamed = resolveGame(item as never, [
    {
      ...gameRow,
      id: "lifeafter",
      name: DISPLAY_NAME_OVERRIDES["lifeafter-credits"].name,
      short_name: DISPLAY_NAME_OVERRIDES["lifeafter-credits"].shortName,
    },
  ] as never);
  assert.equal(
    ifFullyRenamed.create,
    true,
    "rename penuh akan menghasilkan duplikat — id harus tetap dari slug brand",
  );

  // Mengubah `name` SAJA aman selama id tidak ikut berubah: pencocokan tetap
  // berhasil lewat id. Itu sebabnya override cukup di sisi tampilan.
  const ifNameOnlyChanged = resolveGame(item as never, [
    { ...gameRow, name: DISPLAY_NAME_OVERRIDES["lifeafter-credits"].name },
  ] as never);
  assert.equal(
    ifNameOnlyChanged.create,
    false,
    "override nama tampilan harus tidak mengganggu pencocokan SKU",
  );
});

test("game katalog baru punya requires_server sesuai templatenya", () => {
  // Hanya LifeAfter yang butuh server di antara delapan game ini.
  // Kalau `requires_server` false di database padahal template memuat
  // `{server_id}`, form tidak pernah menanyakan server, `serverId` selalu
  // `null`, dan `renderFulfillmentTarget` melempar error — order gagal total.
  const serverGames = ["lifeafter-credits"];

  for (const id of serverGames) {
    const curated = getCuratedGameTarget(id);
    assert.ok(curated?.template, `${id} tidak punya template`);
    assert.ok(
      curated.template.includes("{server_id}"),
      `${id} template harus memuat {server_id}`,
    );
    assert.equal(curated.requiresServer, true, `${id} requires_server harus true`);

    // Kolom server harus muncul di form kalau requiresServer true.
    const schema = getGameAccountSchema({ id, name: id, requiresServer: true });
    assert.ok(schema.server, `${id} tidak punya kolom server di form`);
  }

  // Tujuh game ID-saja: tidak boleh punya kolom server.
  //
  // `one-punch-man` dan `tom-and-jerry-chase` pernah ada di kelompok server
  // karena reseller pihak ketiga menyebutkannya. Keduanya dikoreksi pada
  // 2026-10-09 setelah Deskripsi Seller di panel Digiflazz menyatakan
  // "Tujuan = User ID" dan "Tujuan = User ID (Server Tidak Perlu)".
  const idOnlyGames = [
    "one-punch-man",
    "tom-and-jerry-chase",
    "laplace-m",
    "lords-mobile",
    "speed-drifters",
    "werewolf-party-game",
    "au2-mobile",
  ];
  for (const id of idOnlyGames) {
    const curated = getCuratedGameTarget(id);
    assert.equal(curated?.requiresServer, false, `${id} tidak butuh server`);
    assert.equal(curated?.template, "{user_id}", `${id} template harus {user_id}`);

    // Dan form tidak boleh menanyakan server sama sekali.
    const schema = getGameAccountSchema({ id, name: id, requiresServer: true });
    assert.equal(schema.server, undefined, `${id} masih punya kolom server`);
  }
});

test("nama brand LifeAfter tidak berubah di sisi lookup", () => {
  // Normalisasi yang dipakai `resolveGame`. Kalau aturan ini berubah,
  // kecocokan SKU-to-game ikut berubah dan duplikat bisa muncul lagi.
  assert.equal(normalizeText("LifeAfter Credits"), "lifeafter credits");
  assert.equal(normalizeText("LifeAfter"), "lifeafter");
  assert.notEqual(
    normalizeText("LifeAfter"),
    normalizeText("LifeAfter Credits"),
    "nama database dan brand harus tetap berbeda",
  );
});