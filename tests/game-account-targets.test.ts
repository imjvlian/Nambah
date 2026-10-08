import assert from "node:assert/strict";
import test from "node:test";
import {
  getGameAccountSchema,
  validateGameAccountTarget,
} from "../src/lib/game-account.ts";

/**
 * Game yang kembali ke schema `generic` sebelum-September 2026.
 *
 * Sembilan game ini punya `fulfillment_target_template` kosong di database dan
 * tidak punya cabang di `getGameAccountSchema`, jadi semua 132 produknya hanya
 * mendapat field "User ID / Tujuan" bebas. Tes di sini mengunci bahwa setiap
 * game sudah punya skema khusus — regresi ke `generic` akan menggagalkan test.
 *
 * Sumber kebutuhan: kolom "Deskripsi Produk" di Digiflazz Buyer Member Panel.
 */

type GameCase = {
  id: string;
  name: string;
  requiresServer?: boolean;
  kind: string;
  userLabel: string;
  /** Contoh input yang harus lolos. */
  validUser: string;
  /** Contoh input yang harus ditolak. */
  invalidUser: string;
  /** Contoh server yang harus lolos, kalau `requiresServer`. */
  validServer?: string;
  checker: string | null;
};

const CASES: GameCase[] = [
  {
    // Deskripsi Seller panel Digiflazz: "Note : User ID|Server  Contoh :
    // 400628|030003" — server berupa angka, bukan nama channel.
    id: "dragon-nest-m-classic",
    name: "Dragon Nest M Classic",
    requiresServer: true,
    kind: "numeric-player",
    userLabel: "User ID",
    validUser: "400628",
    invalidUser: "abc",
    validServer: "030003",
    // Tidak ada route Volsever untuk Dragon Nest.
    checker: null,
  },
  {
    // Deskripsi Digiflazz: `Masukkan ID dan Server`. Server berupa wilayah:
    // Asia, Europe, NA, LATAM, Oceania.
    id: "nba-infinite",
    name: "NBA Infinite",
    requiresServer: true,
    kind: "numeric-player",
    userLabel: "ID",
    validUser: "12345678",
    invalidUser: "123",
    validServer: "Asia",
    // Route Volsever-nya ada tapi health check-nya `fail`.
    checker: null,
  },
  {
    // Deskripsi Digiflazz: `Masukkan User ID.`
    id: "state-of-survival",
    name: "State of Survival",
    kind: "numeric-player",
    userLabel: "User ID",
    validUser: "1234567",
    invalidUser: "abc123",
    // Route Volsever `state-of-survival` berstatus `fail`.
    checker: null,
  },
  {
    // Deskripsi Digiflazz: `Masukkan ID Akun`.
    id: "where-winds-meet",
    name: "Where Winds Meet",
    kind: "numeric-player",
    userLabel: "ID Akun",
    validUser: "12345678",
    invalidUser: "12345",
    checker: "universal",
  },
  {
    // Deskripsi Digiflazz: `Masukkan PlayerID`.
    id: "call-of-duty-mobile",
    name: "Call of Duty Mobile",
    kind: "numeric-player",
    userLabel: "Player ID",
    validUser: "1234567890",
    invalidUser: "player#1",
    checker: "universal",
  },
  {
    // Deskripsi Digiflazz: `Nomor tujuan diisi dengan nomor hp yang terdaftar
    // di Vidio` — bukan email.
    id: "vidio",
    name: "Vidio",
    kind: "phone",
    userLabel: "Nomor HP",
    validUser: "081234567890",
    invalidUser: "0812",
    checker: null,
  },
  {
    // Deskripsi Digiflazz tidak menyebut target sama sekali, tapi API Digiflazz
    // mewajibkan customer_no. Email atau nomor HP dipakai sebagai referensi.
    id: "xbox",
    name: "Xbox",
    kind: "contact",
    userLabel: "Email / No. HP",
    validUser: "pemain@email.com",
    invalidUser: "bukan kontak",
    checker: null,
  },
];

test("sembilan game yang dulu generic punya skema khusus", () => {
  for (const item of CASES) {
    const schema = getGameAccountSchema({
      id: item.id,
      name: item.name,
      requiresServer: item.requiresServer,
    });

    assert.notEqual(
      schema.kind,
      "generic",
      `${item.id} masih jatuh ke generic`,
    );
    assert.equal(schema.kind, item.kind, `${item.id} kind tidak sesuai`);
    assert.equal(schema.user.label, item.userLabel, `${item.id} label user`);
    assert.equal(schema.checker, item.checker, `${item.id} checker`);
  }
});

test("input valid lolos dan input invalid ditolak untuk tiap game", () => {
  for (const item of CASES) {
    const game = {
      id: item.id,
      name: item.name,
      requiresServer: item.requiresServer,
    };

    const ok = validateGameAccountTarget(
      game,
      item.validUser,
      item.validServer,
    );
    assert.ok(ok.ok, `${item.id} menolak input valid: ${ok.ok ? "" : ok.error}`);
    assert.equal(ok.ok && ok.userId, item.validUser, `${item.id} userId`);

    const rejected = validateGameAccountTarget(
      game,
      item.invalidUser,
      item.validServer,
    );
    assert.equal(
      rejected.ok,
      false,
      `${item.id} menerima input tidak valid: ${item.invalidUser}`,
    );
  }
});

test("game tanpa requiresServer tidak pernah meminta server", () => {
  // Untuk game ID-saja, mengetik kolom server tidak boleh bisa Influence
  // hasil validasi — kalau tidak, ID yang valid bisa ditolak.
  for (const item of CASES.filter((entry) => !entry.requiresServer)) {
    const game = { id: item.id, name: item.name, requiresServer: false };
    const schema = getGameAccountSchema(game);
    assert.equal(schema.server, undefined, `${item.id} punya field server`);

    const result = validateGameAccountTarget(game, item.validUser, "999");
    assert.ok(result.ok, `${item.id} menolak input valid`);
    // `serverId` tidak boleh ikut terpakai dari input, kalau tidak ID valid
    // bisa gagal karena kolom yang memang tidak ada.
    assert.equal(result.ok && result.serverId, undefined, `${item.id} serverId`);
  }
});

test("server wajib diisi kalau requires_server di database", () => {
  for (const item of CASES.filter((entry) => entry.requiresServer)) {
    const game = {
      id: item.id,
      name: item.name,
      requiresServer: true,
    };
    const missing = validateGameAccountTarget(game, item.validUser, "");
    assert.equal(
      missing.ok,
      false,
      `${item.id} menerima order tanpa server`,
    );
  }
});

test("zenless zone zero: UID + dropdown server seperti Genshin", () => {
  const game = {
    id: "zenless-zone-zero",
    name: "Zenless Zone Zero",
    requiresServer: true,
  };
  const schema = getGameAccountSchema(game);

  assert.equal(schema.kind, "zenless-zone-zero");
  assert.equal(schema.user.label, "UID");
  assert.equal(schema.checker, "universal");
  assert.deepEqual(schema.server?.options, [
    "Asia",
    "America",
    "Europe",
    "TW/HK/MO",
  ]);

  assert.ok(
    validateGameAccountTarget(game, "1234567890", "Asia").ok,
    "UID + server valid ditolak",
  );

  // Case-sensitivity harus diteolak: `asia` tidak akan dikenali supplier.
  assert.equal(
    validateGameAccountTarget(game, "1234567890", "asia").ok,
    false,
    "server lowercase lolos",
  );
  assert.equal(
    validateGameAccountTarget(game, "1234567890", "Indonesia").ok,
    false,
    "server di luar daftar lolos",
  );
  assert.equal(
    validateGameAccountTarget(game, "12345", "Asia").ok,
    false,
    "UID terpendek lolos",
  );
});

test("mobile legends adventure: ID + Zone ID, sama seperti MLBB", () => {
  // Ini game yang paling berbeda kasusnya: ia punya cabang schema yang benar
  // sejak awal, tapi `fulfillment_target_template`-nya kosong — jadi formnya
  // menanyakan ID + Zone ID sementara fulfillment tidak punya template untuk
  // disusun. Schema di sini hanya menutup bagian form.
  const game = {
    id: "mobile-legends-adventure",
    name: "Mobile Legends Adventure",
    requiresServer: true,
  };
  const schema = getGameAccountSchema(game);

  assert.equal(schema.kind, "mobile-legends");
  assert.equal(schema.user.label, "User ID");
  assert.equal(schema.server?.label, "Zone ID");
  assert.equal(schema.checker, "mobile-legends");

  assert.ok(validateGameAccountTarget(game, "123456789", "2685").ok);
  assert.equal(validateGameAccountTarget(game, "123456789", "").ok, false);
});