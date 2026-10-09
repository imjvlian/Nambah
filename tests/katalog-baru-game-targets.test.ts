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
} from "../src/lib/game-targets.ts";
import { renderFulfillmentTarget } from "../src/lib/fulfillment-target.ts";

/**
 * Delapan game katalog baru (2026-10-09).
 *
 * Semuanya lahir dengan `fulfillment_target_template` NULL dan jatuh ke
 * cabang `generic` di `getGameAccountSchema` — field teks bebas 3-64 karakter
 * tanpa server. Untuk game yang ID-nya angka, teks bebas terlalu longgar: ID
 * salah lolos validasi lalu ditolak supplier setelah pembayaran.
 *
 * Berbeda dengan test `game-targets.test.ts` yang lima gamenya, nilai di sini
 * TIDAK berasal dari kolom "Deskripsi Produk" Digiflazz. Hanya tiga game yang
 * description-nya memberi sinyal; sisanya `-` atau kosong. Yang dipakai adalah
 * sumber independen per game, tercatat di `src/lib/game-targets.ts`.
 */

const NEW_GAMES = [
  "laplace-m",
  "lifeafter-credits",
  "lords-mobile",
  "one-punch-man",
  "speed-drifters",
  "tom-and-jerry-chase",
  "werewolf-party-game",
  "au2-mobile",
] as const;

test("delapan game baru punya template kurasi", () => {
  for (const id of NEW_GAMES) {
    const entry = CURATED_GAME_TARGETS[id];
    assert.ok(entry, `${id} tidak ada di CURATED_GAME_TARGETS`);
    assert.ok(entry.template, `${id} template kosong`);
  }

  // Tidak boleh muncul di daftar blocker.
  assert.deepEqual(
    gamesMissingCuratedTarget([...NEW_GAMES]),
    [],
    "masih ada yang ditandai blocker",
  );
});

test("format order delapan game baru sesuai Deskripsi Seller Digiflazz", () => {
  // Sumber di sini adalah Deskripsi Seller di panel Digiflazz, bukan reseller
  // pihak ketiga. Alasannya sudah terbukti: kolom Deskripsi Produk ternyata
  // bisa jadi boilerplate (lihat test koreksi di bawah).
  const cases: Array<[string, string]> = [
    // LifeAfter: Deskripsi Seller menulis literal
    // "FORMAT : USER ID|SERVER contoh 123456|500001". Pipe literal.
    ["lifeafter-credits", "{user_id}|{server_id}"],
    // ID saja. Enam game ini tidak punya kolom server.
    ["one-punch-man", "{user_id}"],
    ["tom-and-jerry-chase", "{user_id}"],
    ["laplace-m", "{user_id}"],
    ["lords-mobile", "{user_id}"],
    ["speed-drifters", "{user_id}"],
    ["werewolf-party-game", "{user_id}"],
    ["au2-mobile", "{user_id}"],
  ];

  for (const [id, template] of cases) {
    assert.equal(CURATED_GAME_TARGETS[id].template, template, `${id} template salah`);
  }
});

test("requires_server sinkron dengan template", () => {
  // Kombinasi `requires_server = true` dengan template tanpa `{server_id}`
  // membuat `renderFulfillmentTarget` melempar error — order GAGAL, bukan
  // order terkirim dengan ID salah. Ini harus mustahil.
  for (const id of NEW_GAMES) {
    const entry = CURATED_GAME_TARGETS[id];
    assert.equal(
      entry.requiresServer,
      entry.template.includes("{server_id}"),
      `${id}: requires_server tidak sinkron dengan template`,
    );
  }
});

test("customer_no delapan game baru ter-render sesuai pemisahnya", () => {
  // Hanya LifeAfter yang punya server — dari delapan game ini.
  const serverGames = [
    ["lifeafter-credits", "{user_id}|{server_id}", "123456", "500001", "123456|500001"],
  ] as const;

  for (const [id, template, userId, serverId, expected] of serverGames) {
    const rendered = renderFulfillmentTarget(template, {
      userId,
      serverId,
      requiresServer: CURATED_GAME_TARGETS[id].requiresServer,
    });
    assert.equal(rendered.customerNo, expected, `${id} customer_no salah`);
  }

  // Tujuh game ID-saja: server tidak boleh muncul di customer_no.
  for (const id of [
    "one-punch-man",
    "tom-and-jerry-chase",
    "laplace-m",
    "lords-mobile",
    "speed-drifters",
    "werewolf-party-game",
    "au2-mobile",
  ] as const) {
    const rendered = renderFulfillmentTarget(CURATED_GAME_TARGETS[id].template!, {
      userId: "1234567890",
      requiresServer: false,
    });
    assert.equal(rendered.customerNo, "1234567890", `${id} ada server padahal ID-saja`);
  }
});

test("game yang seller-nya bilang 'ID saja' tidak boleh punya kolom server", () => {
  // Dua game ini pernah punya kolom server karena reseller pihak ketiga
  // menyebutkannya. Deskripsi Seller di panel Digiflazz menyatakan sebaliknya,
  // dan itu yang mengarahkan koreksi:
  //
  //   Tom and Jerry (TJ180): "Tujuan = User ID (Server Tidak Perlu)"
  //   One Punch Man  (OPM1):  "Tujuan = ID saja salah otomatis gagal"
  //
  // Meminta server untuk game yang hanya butuh ID berarti order ditolak
  // SETELAH pelanggan membayar.
  for (const [id, name] of [
    ["tom-and-jerry-chase", "Tom and Jerry: Chase"],
    ["one-punch-man", "One Punch Man"],
  ] as const) {
    for (const requiresServer of [false, true]) {
      const schema = getGameAccountSchema({ id, name, requiresServer });
      assert.equal(
        schema.server,
        undefined,
        `${id} masih punya kolom server untuk requiresServer=${requiresServer}`,
      );
    }

    const curated = CURATED_GAME_TARGETS[id];
    assert.equal(curated.requiresServer, false, `${id} requiresServer harus false`);
    assert.equal(curated.template, "{user_id}", `${id} template harus {user_id}`);

    // Dan ID yang sah tetap diterima.
    assert.ok(
      validateGameAccountTarget({ id, name }, "123456789").ok,
      `${id} menolak ID yang sah`,
    );
  }
});

test("delapan game baru punya skema khusus, bukan generic", () => {
  const cases: Array<[string, string]> = [
    ["laplace-m", "Laplace M"],
    ["lifeafter-credits", "LifeAfter Credits"],
    ["lords-mobile", "Lords Mobile"],
    ["one-punch-man", "One Punch Man"],
    ["speed-drifters", "Speed Drifters"],
    ["tom-and-jerry-chase", "Tom and Jerry: Chase"],
    ["werewolf-party-game", "Werewolf (Party Game)"],
    ["au2-mobile", "AU2 Mobile"],
  ];

  for (const [id, name] of cases) {
    for (const requiresServer of [false, true]) {
      const schema = getGameAccountSchema({ id, name, requiresServer });
      assert.notEqual(schema.kind, "generic", `${id} masih generic`);
      assert.equal(schema.kind, "numeric-player", `${id} kind salah`);
    }
  }
});

test("LifeAfter punya 70 server dan mengirim kodenya", () => {
  const schema = getGameAccountSchema({
    id: "lifeafter-credits",
    name: "LifeAfter Credits",
    requiresServer: true,
  });
  const options = schema.server?.options;
  assert.ok(options, "LifeAfter tidak punya opsi server");
  // 70 server, bukan 90: 9 NA + 2 AU + 10 SEA + 15 HMT + 9 JP + 6 KR + 8 EU
  // + 5 JP-Survival + 2 HMT-Survival + 2 JP-Survival + 1 NA + 1 SEA.
  assert.equal(options.length, 70, "jumlah server LifeAfter berubah");

  // Dua kolom, keduanya wajib.
  assert.ok(schema.server, "kolom server tidak ada");
  assert.ok(schema.user.pattern?.test("123456"), "user ID valid ditolak");
  assert.equal(schema.user.pattern?.test("12345"), false, "user ID pendek lolos");

  // Server dikirim sebagai KODE, bukan nama. Ini yang membuat pipe `500001`
  // benar — kalau yang dikirim nama server, `customer_no` tidak akan bisa
  // melewati filter karakter di `renderFulfillmentTarget` untuk nama Mandarin
  // dan katakana.
  const opts = options.map((option) => ({
    value: accountFieldOptionValue(option),
    label: accountFieldOptionLabel(option),
  }));

  for (const { value, label } of opts) {
    assert.match(value, /^\d{6}$/, `value server bukan 6 digit: ${value}`);
    assert.ok(label.length > 0, "label server kosong");
    // Label memuat nama + region dalam kurung.
    assert.match(label, /\((NA|AU|SEA|HMT|JP|KR|EU)\)$/, `label tidak ada region: ${label}`);
  }

  // Kode unik — tidak boleh ada server yang bisa dipilih dua kali.
  const values = opts.map((o) => o.value);
  assert.equal(new Set(values).size, 70, "ada kode server duplikat");

  // Contoh dari panel Digiflazz harus bisa dipilih.
  assert.ok(
    opts.some((o) => o.value === "500001" && o.label.startsWith("MiskaTown")),
    "MiskaTown (NA) 500001 tidak ditemukan",
  );
  assert.ok(
    opts.some((o) => o.value === "530001" && o.label.includes("多貝雪山")),
    "多貝雪山 (HMT) 530001 tidak ditemukan",
  );
  assert.ok(
    opts.some((o) => o.value === "730001" && o.label.startsWith("EasySurvival")),
    "EasySurvival (SEA) 730001 tidak ditemukan",
  );
});

test("Tom and Jerry tidak punya kolom server sama sekali", () => {
  // Test ini dulu mengunci kolom server free-text ("Asia") dan pemisah koma,
  // bersandar pada Codashop SG, NetEase, dan itemku. Ketiganya pihak ketiga.
  //
  // Deskripsi Seller di panel Digiflazz untuk dua SKU berbeda menyebut:
  //   pre34663343 (TTAJ60): "Tujuan = User ID"
  //   pre34663344 (TJ180):  "Tujuan = User ID (Server Tidak Perlu)"
  //
  // Jadi test-nya dibalik — bukan dihapus, supaya koreksi ini tercatat dan
  // tidak diam-diam dikembalikan.
  const schema = getGameAccountSchema({
    id: "tom-and-jerry-chase",
    name: "Tom and Jerry: Chase",
    requiresServer: true,
  });
  assert.equal(
    schema.server,
    undefined,
    "Tom and Jerry tidak butuh server — jangan kolom server",
  );
  assert.equal(schema.user.label, "Player ID");
  assert.equal(schema.user.sanitize, "digits");

  // ID saja, tanpa pemisah apa pun.
  const rendered = renderFulfillmentTarget(CURATED_GAME_TARGETS["tom-and-jerry-chase"].template!, {
    userId: "11777888",
    requiresServer: false,
  });
  assert.equal(rendered.customerNo, "11777888");
  assert.equal(rendered.allowDot, false);
});

test("Speed Drifters tidak tertangkap cabang voucher Garena", () => {
  // Speed Drifters punya publisher Garena. Cabang voucher di
  // `getGameAccountSchema` memakai pola `\bgarena\b` dan meminta EMAIL —
  // kalau game ini ikut ke sana, tidak ada pelanggan yang bisa order karena
  // semua Orang-Orang tidak punya email di form.
  const schema = getGameAccountSchema({
    id: "speed-drifters",
    name: "Speed Drifters",
  });
  assert.equal(schema.kind, "numeric-player", "Speed Drifters dianggap voucher");
  assert.equal(schema.user.label, "Player ID");
  assert.ok(
    validateGameAccountTarget({ id: "speed-drifters", name: "Speed Drifters" }, "628211234567")
      .ok,
    "Player ID Garena ditolak",
  );
  assert.equal(
    validateGameAccountTarget({ id: "speed-drifters", name: "Speed Drifters" }, "nama@email.com")
      .ok,
    false,
    "email lolos untuk Speed Drifters",
  );
});

test("lima game ID-saja tidak punya kolom server", () => {
  const cases: Array<[string, string, string]> = [
    ["laplace-m", "Laplace M", "1234567"],
    ["lords-mobile", "Lords Mobile", "4295037856"],
    ["speed-drifters", "Speed Drifters", "628211234567"],
    ["werewolf-party-game", "Werewolf (Party Game)", "1234567"],
    ["au2-mobile", "AU2 Mobile", "1234567"],
  ];

  for (const [id, name, validId] of cases) {
    const schema = getGameAccountSchema({ id, name });
    assert.equal(schema.server, undefined, `${id} punya kolom server`);
    assert.equal(schema.user.sanitize, "digits", `${id} user ID bukan numerik`);
    assert.ok(
      validateGameAccountTarget({ id, name }, validId).ok,
      `${id} menolak ID yang sah: ${validId}`,
    );
    // Teks bebas harus ditolak: itulah bedanya dari cabang `generic` lama.
    assert.equal(
      validateGameAccountTarget({ id, name }, "Pemain#ID1").ok,
      false,
      `${id} menerima teks bebas`,
    );
  }
});

test("label kolom memakai istilah game masing-masing", () => {
  // Memakai "User ID" generik untuk semuanya membuat pelanggan mencari kolom
  // yang tidak ada. Laplacian punya Character ID, Lords Mobile punya IGG ID.
  assert.equal(
    getGameAccountSchema({ id: "laplace-m", name: "Laplace M" }).user.label,
    "Character ID",
  );
  assert.equal(
    getGameAccountSchema({ id: "lords-mobile", name: "Lords Mobile" }).user.label,
    "IGG ID",
  );
  assert.equal(
    getGameAccountSchema({ id: "lifeafter-credits", name: "LifeAfter Credits" }).user.label,
    "User ID",
  );
  assert.equal(
    getGameAccountSchema({
      id: "one-punch-man",
      name: "One Punch Man",
    }).user.label,
    "User ID",
  );
});