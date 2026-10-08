import assert from "node:assert/strict";
import test from "node:test";
import {
  TELEGRAM_TEXT_LIMIT,
  escapeTelegramHtml,
  parseOrderId,
  parseTelegramCommand,
  previewForLog,
  telegramHelpText,
  truncateForTelegram,
} from "../src/lib/telegram-format.ts";

test("escapeTelegramHtml: menutup tiga karakter yang merusak parse_mode HTML", () => {
  assert.equal(escapeTelegramHtml("a & b"), "a &amp; b");
  assert.equal(escapeTelegramHtml("<b>tebal</b>"), "&lt;b&gt;tebal&lt;/b&gt;");
  assert.equal(escapeTelegramHtml("a & <b>"), "a &amp; &lt;b&gt;");

  // Escaping harus berurutan: `&` lebih dulu, kalau tidak `&lt;` jadi `&amp;lt;`.
  assert.equal(escapeTelegramHtml("&lt;"), "&amp;lt;");
});

test("escapeTelegramHtml: menutup vektor injeksi dari data supplier", () => {
  const label = 'Diamond <script>alert(1)</script> & "karung"';
  const escaped = escapeTelegramHtml(label);

  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
  assert.match(escaped, /&amp;/);
});

test("truncateForTelegram: tidak mengubah pesan yang sudah di bawah batas", () => {
  const short = "halo";
  assert.equal(truncateForTelegram(short), short);
});

test("truncateForTelegram: memotong pesan panjang dan menandainya", () => {
  const long = "x".repeat(TELEGRAM_TEXT_LIMIT + 500);
  const truncated = truncateForTelegram(long);

  // Panjang hasil WAJIB di bawah batas — kalau tidak, Telegram menolak dengan
  // 400 dan seluruh pesan hilang.
  assert.ok(
    truncated.length <= TELEGRAM_TEXT_LIMIT,
    `panjang ${truncated.length} melebihi ${TELEGRAM_TEXT_LIMIT}`,
  );
  assert.match(truncated, /pesan dipotong/);
});

test("previewForLog: satu baris dan dipotong", () => {
  assert.equal(previewForLog("a\n\n  b   c "), "a b c");
  const long = "y".repeat(400);
  assert.ok(previewForLog(long).length <= 241);
});

test("parseTelegramCommand: membaca perintah, argumen, dan suffix @namabot", () => {
  assert.deepEqual(parseTelegramCommand("/status"), {
    command: "/status",
    argument: "",
  });

  assert.deepEqual(parseTelegramCommand("/order NBH-20261008-ABC123"), {
    command: "/order",
    argument: "NBH-20261008-ABC123",
  });

  // Bot di grup akan mengirim "/status@nambah_bot".
  assert.deepEqual(parseTelegramCommand("/status@nambah_bot"), {
    command: "/status",
    argument: "",
  });

  assert.deepEqual(parseTelegramCommand("/retry-receipt NBH-1"), {
    command: "/retry-receipt",
    argument: "NBH-1",
  });
});

test("parseTelegramCommand: mengabaikan pesan yang bukan perintah", () => {
  assert.equal(parseTelegramCommand("halo"), null);
  assert.equal(parseTelegramCommand(""), null);
  assert.equal(parseTelegramCommand("  "), null);
  assert.equal(parseTelegramCommand("mau kirim /status dong"), null);
});

test("parseTelegramCommand: argumen dikumpulkan, spasi berlebih diratakan", () => {
  assert.deepEqual(parseTelegramCommand("/note NBH-1 halo dunia"), {
    command: "/note",
    argument: "NBH-1 halo dunia",
  });

  // `split(/\s+/)` meratakan spasi beruntun — jadi argumen yang ditulis dengan
  // spasi ganda tidak bikin perintah gagal mencocokkan.
  assert.deepEqual(parseTelegramCommand("/note NBH-1  halo  dunia"), {
    command: "/note",
    argument: "NBH-1 halo dunia",
  });
});

test("parseOrderId: hanya menerima bentuk order id Nambah", () => {
  assert.equal(parseOrderId("nbh-20261008-abc123"), "NBH-20261008-ABC123");
  assert.equal(parseOrderId("  NBH-20261008-ABC123  "), "NBH-20261008-ABC123");

  // Query tidak boleh jalan untuk input yang jelas bukan order id.
  assert.equal(parseOrderId("abc"), null);
  assert.equal(parseOrderId("NBH-"), null);
  assert.equal(parseOrderId("'; drop table orders; --"), null);
  assert.equal(parseOrderId("*"), null);
});

test("telegramHelpText: mendaftarkan perintah yang benar-benar ada", () => {
  const help = telegramHelpText();

  for (const command of [
    "/status",
    "/saldo",
    "/order",
    "/incident",
    "/retry-receipt",
    "/help",
  ]) {
    assert.ok(help.includes(command), `help harus menyebut ${command}`);
  }
});