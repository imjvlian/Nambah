import assert from "node:assert/strict";
import test from "node:test";
import { renderFulfillmentTarget } from "../src/lib/fulfillment-target.ts";

test("renders user-only fulfillment target", () => {
  assert.deepEqual(
    renderFulfillmentTarget("{user_id}", { userId: "123456" }),
    { customerNo: "123456", allowDot: false },
  );
});

test("renders user and server target", () => {
  assert.equal(
    renderFulfillmentTarget("{user_id}|{server_id}", {
      userId: "123456",
      serverId: "7890",
      requiresServer: true,
    }).customerNo,
    "123456|7890",
  );
});

test("allows # for Riot ID customer_no (Valorant)", () => {
  assert.equal(
    renderFulfillmentTarget("{user_id}", { userId: "Joko#1234" }).customerNo,
    "Joko#1234",
  );
});

test("allows koma as separator for Heroes Evolved and NBA Infinite", () => {
  // Tabel format reseller Digiflazz:
  //   Heroes Evolved : "Format tujuan : User ID,Server  Contoh : 12345,100"
  //   NBA Infinite   : "Format tujuan : User ID,Server  Contoh : 12345,1001"
  assert.equal(
    renderFulfillmentTarget("{user_id},{server_id}", {
      userId: "12345",
      serverId: "100",
      requiresServer: true,
    }).customerNo,
    "12345,100",
  );
  assert.equal(
    renderFulfillmentTarget("{user_id},{server_id}", {
      userId: "12345",
      serverId: "1001",
      requiresServer: true,
    }).customerNo,
    "12345,1001",
  );
});

test("allows / for region names and spaces for server names", () => {
  // Region TW/HK/MO dipakai Genshin, Honkai Star Rail, dan Zenless Zone Zero.
  // Deskripsi Seller menulisnya `TW, HK, MO` — dengan koma. Karena koma adalah
  // separator di template, nilai yang dikirim memakai kode `os_cht` yang tidak
  // mengandung tanda baca sama sekali.
  assert.equal(
    renderFulfillmentTarget("{user_id}|{server_id}", {
      userId: "123456789",
      serverId: "os_cht",
      requiresServer: true,
    }).customerNo,
    "123456789|os_cht",
  );

  // `/` tetap diizinkan: Wuthering Waves masih memakai nama region, dan
  // "TW/HK/MO" adalah bentuk yang biasa customer ketik.
  assert.equal(
    renderFulfillmentTarget("{user_id}|{server_id}", {
      userId: "123456789",
      serverId: "TW/HK/MO",
      requiresServer: true,
    }).customerNo,
    "123456789|TW/HK/MO",
  );

  // Lima server Ragnarok M semuanya mengandung spasi.
  for (const server of [
    "Eternal Love",
    "Midnight Party",
    "Memory Of Faith",
    "Valhalla Glory",
    "Port City",
  ]) {
    assert.equal(
      renderFulfillmentTarget("{user_id}|{server_id}", {
        userId: "123378499",
        serverId: server,
        requiresServer: true,
      }).customerNo,
      `123378499|${server}`,
      `server ${server} ditolak`,
    );
  }
});

test("tetap menolak karakter yang tidak aman", () => {
  // Guard ini tetap harus menahan kutip,backslash, dan karakter kontrol.
  for (const userId of ['a"b', "a\\b", "a;b", "a\nb", "a<script>", "a$b"]) {
    assert.throws(
      () => renderFulfillmentTarget("{user_id}", { userId }),
      `karakter berbahaya lolos: ${JSON.stringify(userId)}`,
    );
  }
});

test("rejects unsafe or incomplete templates", () => {
  assert.throws(() => renderFulfillmentTarget("", { userId: "123" }));
  assert.throws(() =>
    renderFulfillmentTarget("{user_id}", {
      userId: "123",
      serverId: "456",
      requiresServer: true,
    }),
  );
  assert.throws(() =>
    renderFulfillmentTarget("{user_id}{password}", { userId: "123" }),
  );
});
