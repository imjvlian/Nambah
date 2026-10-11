import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedGroupChat,
  parseAllowedGroupIds,
  UNREGISTERED_GROUP_NOTICE_LIMIT,
  unregisteredGroupNotice,
  unregisteredGroupNoticeKey,
} from "../src/lib/telegram-group-notice.ts";

/**
 * Sapaan untuk grup yang belum terdaftar.
 *
 * Bug yang memicu file ini: bot diam di grup yang salah tempat, dan
 * satu-satunya gejala dari sisi Telegram adalah
 * tidak terjadi apa-apa. Tidak ada error, tidak ada notifikasi, dan
 * operator harus menggali log server untuk menemukan satu baris
 * `allowed: false`.
 *
 * Test di sini mengunci bahwa sapaan itu benar-benar berisi ID grup
 * - karena kalau tidak, perbaikannya tetap tidak bisa dikerjakan.
 */

test("grup terdaftar dilayani, grup lain tidak", () => {
  const allowed = ["-1001234567890"];

  assert.equal(
    isAllowedGroupChat("-1001234567890", "supergroup", allowed),
    true,
  );
  assert.equal(
    isAllowedGroupChat("-1009999999999", "supergroup", allowed),
    false,
  );
});

test("grup yang terdaftar dilayani, tipe apa pun", () => {
  const allowed = ["-1001111111111"];

  assert.equal(isAllowedGroupChat("-1001111111111", "group", allowed), true);
  assert.equal(
    isAllowedGroupChat("-1001111111111", "supergroup", allowed),
    true,
  );
});

test("chat pribadi selalu ditolak, walau ID-nya ada di daftar", () => {
  /*
   * Bot harusnya hanya menjawab di grup yang ditunjuk operator. Membalas
   * di DM membuka permukaan perintah yang tidak perlu ada - dan DM
   * adalah tempat orang mengetik perintah tanpa sengaja.
   */
  const allowed = ["-1001111111111"];

  assert.equal(isAllowedGroupChat("-1001111111111", "private", allowed), false);
});
test("daftar ID dipangkas spasi dan entah kosong diabaikan", () => {

  const parsed = parseAllowedGroupIds(
    " -1001111111111 , , -1002222222222 ,\n-1003333333333 ",
  );

  assert.deepEqual(parsed, [
    "-1001111111111",
    "-1002222222222",
    "-1003333333333",
  ]);
});

test("daftar yang belum diisi berarti tidak ada grup yang boleh", () => {
  assert.deepEqual(parseAllowedGroupIds(undefined), []);
  assert.deepEqual(parseAllowedGroupIds(null), []);
  assert.deepEqual(parseAllowedGroupIds(""), []);
  assert.deepEqual(parseAllowedGroupIds("   "), []);
});

test("sapaan memuat ID grup - itu yang dibutuhkan operator", () => {
  /*
   * Tanpa ID grup di dalam pesan, operator tetap harus menggali log
   * untuk mencari ID-nya. Dan mencari ID grup dari log jauh lebih
   * sulit daripada menyalinnya dari chat yang sedang terjadi.
   */
  const text = unregisteredGroupNotice("-1009876543210", "nambahtopbot");

  assert.ok(
    text.includes("-1009876543210"),
    "ID grup harus tertulis apa adanya di dalam pesan",
  );
  assert.ok(text.includes("@nambahtopbot"), "nama bot ditulis sebagai @username");
  assert.ok(
    text.includes("TELEGRAM_ALLOWED_GROUP_IDS=-1009876543210"),
    "persis apa yang harus ditambahkan ke .env.local",
  );
  assert.ok(
    text.includes("TELEGRAM_ADMIN_CHAT_ID=-1009876543210"),
    "alert keluar juga perlu diarahkan ke grup ini",
  );
});

test("sapaan tanpa username tetap terbaca dan tidak jadi 'undefined'", () => {
  const text = unregisteredGroupNotice("-1009876543210", "");

  assert.ok(text.includes("-1009876543210"));
  assert.ok(!text.includes("undefined"), "tidak boleh ada teks 'undefined'");
});

test("sapaan tanpa parse_mode: tidak ada karakter yang perlu di-escape", () => {
  /*
   * Pesan dikirim polos, bukan HTML. Kalau suatu saat ada yang menambahkan
   * `parse_mode` tanpa mengubah isi pesan, kurung siku dan tanda hubung
   * akan dimakan parser Telegram dan operator melihat teks rusak tanpa
   * tahu knapa.
   */
  const text = unregisteredGroupNotice("-1009876543210", "nambahtopbot");

  assert.ok(!text.includes("&lt;"));
  assert.ok(!text.includes("&amp;"));
  assert.ok(!text.includes("\\\\"));
});

test("kunci dedupe stabil per grup, bukan per waktu", () => {
  /*
   * Kalau kuncinya ikut berubah setiap panggilan, dedupe tidak pernah
   * bekerja dan grup yang salah tempat akan menerima sapaan ulang
   * setiap kali ada yang mengetik di sana.
   */
  const a = unregisteredGroupNoticeKey("-1001111111111");
  const b = unregisteredGroupNoticeKey("-1001111111111");
  const other = unregisteredGroupNoticeKey("-1002222222222");

  assert.equal(a, b);
  assert.notEqual(a, other);
});

test("sapaan hanya dikirim sekali per grup", () => {
  assert.equal(UNREGISTERED_GROUP_NOTICE_LIMIT, 1);
});