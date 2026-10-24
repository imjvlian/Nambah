import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  ORDER_ID_PATTERN,
  orderLookupContactMatches,
} from "../src/lib/order-lookup.ts";

/**
 * P4.2 (24 Okt 2026): cek status order untuk tamu.
 *
 * Order ID berpola tanggal — bisa ditebak. Kontak yang pelanggan isi
 * sendiri saat checkout adalah faktor kedua. Yang dijaga test ini:
 * pencocokannya benar, dan endpoint tidak jadi alat mengintip order
 * milik orang lain.
 */

const ORDER = {
  receipt_email: "Budi@Example.com",
  receipt_whatsapp: "081234567890",
};

test("pencocokan email: case-insensitive, spasi dipangkas", () => {
  assert.equal(orderLookupContactMatches("budi@example.com", ORDER), true);
  assert.equal(orderLookupContactMatches("  BUDI@EXAMPLE.COM  ", ORDER), true);
  assert.equal(orderLookupContactMatches("budi@example.co", ORDER), false);
  assert.equal(orderLookupContactMatches("budi@", ORDER), false);
});

test("pencocokan WhatsApp: format 08 dan 62 dua-duanya diterima", () => {
  assert.equal(orderLookupContactMatches("081234567890", ORDER), true);
  assert.equal(orderLookupContactMatches("6281234567890", ORDER), true);
  assert.equal(orderLookupContactMatches("+62 812-3456-7890", ORDER), true);
  assert.equal(orderLookupContactMatches("081234567891", ORDER), false);
});

test("kolom kosong dan kontak pada order yang null tidak pernah cocok", () => {
  assert.equal(orderLookupContactMatches("", ORDER), false);
  assert.equal(orderLookupContactMatches("   ", ORDER), false);
  assert.equal(
    orderLookupContactMatches("budi@example.com", {
      receipt_email: null,
      receipt_whatsapp: "081234567890",
    }),
    false,
    "email diketik tapi order hanya punya WhatsApp",
  );
  assert.equal(
    orderLookupContactMatches("081234567890", {
      receipt_email: "budi@example.com",
      receipt_whatsapp: null,
    }),
    false,
    "WA diketik tapi order hanya punya email",
  );
});

test("pola Order ID: format NBH-tanggal-kode", () => {
  assert.equal(ORDER_ID_PATTERN.test("NBH-20261024-ABC123DEF4"), true);
  assert.equal(ORDER_ID_PATTERN.test("nbh-20261024-ABC123DEF4"), false, "harus uppercase");
  assert.equal(ORDER_ID_PATTERN.test("NBH-2026-ABCD"), false);
  assert.equal(ORDER_ID_PATTERN.test("'; drop table orders;--"), false);
});

test("endpoint: rate limit + pesan generik + re-mint token", () => {
  const route = readFileSync("src/app/api/order-lookup/route.ts", "utf8");

  // Rate limit duluan — sebelum parsing body sekalipun.
  assert.ok(
    route.includes('scope: "order-lookup"'),
    "rate limit per IP terpasang",
  );
  assert.ok(
    route.indexOf("rateLimitResponse") < route.indexOf("request.json()"),
    "rate limit dicek SEBELUM parsing body",
  );

  // Semua jenis kegagalan memakai pesan generik yang sama.
  const mismatchCount = route.split("ORDER_LOOKUP_MISMATCH_MESSAGE").length - 1;
  assert.ok(
    mismatchCount >= 3,
    "pola salah, order tidak ada, dan kontak tidak cocok — semua pakai pesan yang sama",
  );

  // Berhasil = token baru; token lama ditarik (access_token_hash diganti).
  assert.ok(
    route.includes("access_token_hash: access.tokenHash"),
    "hash token diganti — link lama berhenti bekerja setelah pemulihan",
  );
  assert.ok(
    route.includes("createOrderAccessCookie"),
    "cookie scoped terpasang seperti jalur checkout",
  );
});

test("form + discoverability: satu kolom kontak, dua pintu masuk", () => {
  const form = readFileSync("src/components/OrderLookupForm.tsx", "utf8");
  const page = readFileSync("src/app/cek-status/page.tsx", "utf8");
  const view = readFileSync("src/components/OrderStatusView.tsx", "utf8");
  const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");
  const sitemap = readFileSync("src/app/sitemap.ts", "utf8");

  assert.ok(
    form.includes("placeholder=\"email@contoh.com atau 081234567890\""),
    "satu kolom untuk email ATAU WhatsApp — tanpa pilihan 'jenis kontak'",
  );
  assert.ok(
    form.includes('window.location.assign(data.orderUrl)'),
    "berhasil: langsung diantar ke halaman order",
  );
  assert.ok(
    page.includes('export const dynamic = "force-dynamic"'),
    "force-dynamic (nonce CSP)",
  );

  assert.ok(
    view.includes('href="/cek-status"'),
    "halaman order tidak ditemukan menautkan pemulihan",
  );
  assert.ok(
    footer.includes('href="/cek-status"'),
    "footer: Cek pesanan",
  );
  assert.ok(
    sitemap.includes("${BASE_URL}/cek-status"),
    "sitemap terindeks",
  );
});
