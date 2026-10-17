import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Matcher middleware CSP.
 *
 * Matcher menentukan route mana yang masih memasang CSP. Kesalahan di sini
 * tidak terlihat sebagai error - hanya sebagai "CSP tiba-tiba hilang" atau
 * "middleware jalan sia-sia untuk setiap gambar", dan keduanya baru ketahuan
 * saat produksi.
 *
 * Dua arah yang harus dijaga:
 *
 *   1. TIDAK ADA halaman yang kehilangan CSP. Ini yang meledak di production
 *      pada Oktober 2026, dan tidak diterima - bukan karena matcher, tapi
 *      karena halaman di-prerender tanpa nonce. Matcher adalah lapisan
 *      pertahanan kedua, dan test ini memastikan lapisan itu masih ada.
 *
 *   2. Aset statis TIDAK lagi menjalankan middleware. Di `public/` ada ~390
 *      berkas, hampir semuanya gambar. Semuanya sebelumnya cocok dengan pola
 *      catch-all dan menjalankan `crypto.randomUUID()` plus perakitan string
 *      CSP untuk respons yang tidak pernah membaca header itu.
 *
 * PENTING: middleware dikecualikan berdasarkan EKSTENSI, bukan prefiks `/api/`.
 * `src/app/api/admin/receipt-preview` mengembalikan `text/html` sungguhan, dan
 * membuang `/api/` secara blanket akan melepas CSP dari dokumen yang benar-benar
 * dirender di browser.
 */

const middlewareSource = readFileSync("src/middleware.ts", "utf8");

function readMatcher(): RegExp {
  const match = middlewareSource.match(
    /matcher:\s*\[\s*("(?:[^"\\]|\\.)*")\s*,?\s*\]/,
  );
  assert.ok(match, "src/middleware.ts harus punya satu matcher string literal.");
  const literal = JSON.parse(match[1]!) as string;
  return new RegExp(`^${literal}$`);
}

const matcher = readMatcher();

/** True = middleware jalan, jadi CSP dipasang dan nonce dibuat. */
function runsMiddleware(pathname: string): boolean {
  return matcher.test(pathname);
}

test("halaman publik dan admin tetap mendapat CSP", () => {
  const pages = [
    "/",
    "/login",
    "/register",
    "/privacy",
    "/terms",
    "/refund",
    "/lupa-password",
    "/reset-password",
    "/admin",
    "/admin/operations",
    "/admin/affiliates",
    "/merchant",
    "/merchant/register",
    "/merchant/kasir",
    "/account",
    "/order/NBH-20261017-5F860649E9",
    "/product/mobile-legends",
    "/product/mobile_legends_bang_indonesia",
    "/_not-found",
  ];

  const missed = pages.filter((p) => !runsMiddleware(p));
  assert.deepEqual(
    missed,
    [],
    `Halaman ini tidak mendapat CSP:\n${missed.join("\n")}`,
  );
});

test("route API tetap mendapat CSP, terutama yang mengembalikan HTML", () => {
  const routes = [
    // PENTING: route ini mengembalikan `text/html` dan benar-benar dirender.
    "/api/admin/receipt-preview",
    "/api/admin/overview",
    "/api/catalog",
    "/api/orders",
    "/api/og",
    "/api/health",
    "/api/webhooks/midtrans",
    "/api/cron/reconcile",
  ];

  const missed = routes.filter((p) => !runsMiddleware(p));
  assert.deepEqual(missed, [], `Route ini kehilangan CSP:\n${missed.join("\n")}`);
});

test("aset statis dilewati middleware", () => {
  const assets = [
    "/favicon.ico",
    "/icon.svg",
    "/manifest.webmanifest",
    "/img/hero.png",
    "/images/game/mlbb.jpg",
    "/images/game/mlbb.jpeg",
    "/assets/banner.webp",
    "/fonts/inter.woff2",
    "/fonts/inter.woff",
    "/video/promo.mp4",
    "/docs/syarat.pdf",
    "/_next/static/chunks/main-app.js",
    "/_next/image?url=%2Fimg%2Fhero.png&w=1200&q=75",
  ];

  const stillRunning = assets.filter((p) => runsMiddleware(p));
  assert.deepEqual(
    stillRunning,
    [],
    `Aset ini seharusnya dilewati middleware:\n${stillRunning.join("\n")}`,
  );
});

test("route metadata tanpa ekstensi tetap ikut aturan yang sama", () => {
  /*
   * `/apple-icon` tidak punya ekstensi, jadi TIDAK dikecualikan - itu benar,
   * dan tidak masalah: yang penting matcher tidak memperlakukan route metadata
   * secara berbeda dari dokumen. Yang diminta CSP di sini memang tidak ada,
   * tapi mengecualikannya berdasarkan "ini metadata route" adalah daftar
   * khusus yang harus dijaga; aturan ekstensi sudah cukup.
   */
  assert.equal(runsMiddleware("/apple-icon"), true);
  assert.equal(runsMiddleware("/icon-192.png"), false);
  assert.equal(runsMiddleware("/icon-512.png"), false);
});

test("id produk bertitik tidak diam-diam kehilangan CSP", () => {
  /*
   * `/product/<id>` memakai id dari database, bukan dari kode. Kalau suatu saat
   * ada id yang berakhiran salah satu ekstensi di bawah, halaman produknya akan
   * kehilangan CSP tanpa error apa pun - persis kelas bug yang sudah pernah
   * memengaruhi production, hanya lewat jalur yang berbeda.
   *
   * Test ini menyatakan batasannya dengan jujur: daftar ekstensi di middleware
   * TIDAK boleh memuat apa pun yang mungkin jadi id produk. Yang dikecualikan
   * sengaja hanya format yang mustahil menjadi id.
   */
  const banned = ["json", "css", "js", "mjs", "map", "txt", "xml", "html", "php"];

  const leaked = banned.filter((ext) => !runsMiddleware(`/product/game.${ext}`));
  assert.deepEqual(
    leaked,
    [],
    "Ekstensi ini ada di daftar kecualian middleware dan bisa jadi id produk, " +
      `sehingga halaman produknya akan kehilangan CSP tanpa error: ${leaked.join(", ")}`,
  );
});

test("pencocokan tidak bergantung pada query string", () => {
  // Next.js mencocokkan pathname; query tidak boleh mengubah hasil.
  assert.equal(runsMiddleware("/admin"), true);
  assert.equal(runsMiddleware("/admin?tab=katalog"), true);
});
