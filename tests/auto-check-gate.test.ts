import assert from "node:assert/strict";
import test from "node:test";
import {
  getGameAccountSchema,
  validateGameAccountTarget,
} from "../src/lib/game-account.ts";
import { DEFAULT_VOLSEVER_ROUTES } from "../src/lib/volsever/games.ts";

/**
 * Auto-check nickname di `TopupExperience`.
 *
 * Gate-nya adalah satu baris:
 *
 *   const account = validateGameAccountTarget(selectedGame, userId, serverId);
 *   if (!canCheckUsername || !account.ok) return;
 *
 * Sebelumnya ada tambahan `|| !account.serverId`. Klausa itu mematikan
 * auto-check untuk SETIAP game yang tidak menanyakan server — padahal route
 * Volsever-nya sehat dan API sudah menerima request tanpa `serverId`
 * (`check/route.ts`: `...(serverId ? { serverId } : {})`).
 *
 * Test di bawah mengunci perilakunya supaya tidak kembali diam-diam.
 */

/** Sama persis dengan kondisi di useEffect. */
function shouldAutoCheck(
  game: { id: string; name: string; requiresServer?: boolean },
  rawUserId: string,
  rawServerId?: string,
) {
  const schema = getGameAccountSchema(game);
  const canCheckUsername = Boolean(schema.checker);
  const account = validateGameAccountTarget(game, rawUserId, rawServerId);
  return canCheckUsername && account.ok;
}

/**
 * Delapan game dengan checker yang sehat TAPI tidak punya kolom server.
 * Semua ini mati sebelum perbaikan.
 *
 * ID pada `validUser` harus benar-benar valid untuk game-nya: Riot ID
 * (`Nama#Tag`) hanya untuk game Riot, sisanya Player ID numerik.
 */
const TANPA_SERVER: Array<[string, string, string]> = [
  ["valorant", "Valorant", "Joko#ID1"],
  ["arena-of-valor", "ARENA OF VALOR", "123456789"],
  ["call-of-duty-mobile", "Call of Duty MOBILE", "123456789"],
  ["fc-mobile", "FC Mobile", "123456789"],
  ["league-of-legends-wild-rift", "League of Legends Wild Rift", "Joko#ID1"],
  ["legends-of-runeterra", "Legends of Runeterra", "Joko#ID1"],
  ["delta-force", "Delta Force", "123456789"],
  ["where-winds-meet", "Where Winds Meet", "123456789"],
];

test("auto-check jalan untuk game tanpa kolom server", () => {
  for (const [id, name, validUser] of TANPA_SERVER) {
    const game = { id, name, requiresServer: false };
    const schema = getGameAccountSchema(game);

    assert.equal(schema.server, undefined, `${id} seharusnya tidak punya kolom server`);
    assert.equal(schema.checker, "universal", `${id} punya checker`);

    assert.equal(
      shouldAutoCheck(game, validUser),
      true,
      `${id}: auto-check tidak jalan padahal tidak butuh server`,
    );
  }
});

test("auto-check hanya untuk game yang punya route Volsever", () => {
  // Enam game lain punya checker tapi route-nya belum ada. Setelah perbaikan,
  // auto-check untuk mereka tetap tidak aktif — bukan karena bug, tapi karena
  // tidak ada provider untuk dipanggil.
  const tanpaRoute = [
    "aniimo",
    "free-fire",
    "free-fire-max",
    "league-of-legends-pc",
    "marvel-rivals",
    "point-blank",
  ];

  // `TANPA_SERVER` berisi tuple [id, name, validUser] — route dibaca dari indeks
  // pertama, bukan dari tuple itu sendiri.
  for (const [id] of TANPA_SERVER) {
    assert.ok(
      DEFAULT_VOLSEVER_ROUTES[id],
      `${id} harus punya route Volsever supaya auto-check berguna`,
    );
  }

  for (const id of tanpaRoute) {
    assert.equal(
      DEFAULT_VOLSEVER_ROUTES[id],
      undefined,
      `${id} diperkirakan belum punya route — perbarui test ini kalau sudah`,
    );
  }
});

test("Mobile Legends tidak regresi: zone ID tetap wajib", () => {
  const game = { id: "mobile-legends", name: "MOBILE LEGENDS", requiresServer: true };
  const schema = getGameAccountSchema(game);
  assert.equal(schema.checker, "mobile-legends");
  assert.ok(schema.server, "MLBB harus tetap punya kolom Zone ID");

  // Zone ID ada -> auto-check jalan.
  assert.equal(shouldAutoCheck(game, "123456789", "1234"), true);

  // Zone ID kosong -> validasi menolak, jadi auto-check tidak jalan.
  // Inilah yang membuat klausa `!account.serverId` dispensable: `account.ok`
  // sudah cukup.
  assert.equal(shouldAutoCheck(game, "123456789", ""), false);
  assert.equal(shouldAutoCheck(game, "123456789"), false);
});

test("User ID tidak valid tetap menghentikan auto-check", () => {
  // Guard baru tidak boleh membuat request fired untuk input sampah.
  assert.equal(
    shouldAutoCheck({ id: "valorant", name: "Valorant" }, "Joko"),
    false,
    "Riot ID tanpa #Tag lolos",
  );
  assert.equal(
    shouldAutoCheck({ id: "fc-mobile", name: "FC Mobile" }, ""),
    false,
    "User ID kosong lolos",
  );
});

test("game tanpa checker tidak pernah auto-check", () => {
  // Tanpa route DAN tanpa checker (mis. voucher), tidak ada yang boleh
  // dipanggil sama sekali.
  for (const [id, name] of [
    ["pln", "PLN"],
    ["xbox", "XBOX"],
    ["telkomsel", "TELKOMSEL"],
  ] as const) {
    const schema = getGameAccountSchema({ id, name });
    assert.equal(schema.checker, null, `${id} tidak punya checker`);
    assert.equal(shouldAutoCheck({ id, name }, "123456789"), false);
  }
});