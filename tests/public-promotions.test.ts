import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  isPromotionWindowActive,
  promotionBenefitText,
  promotionRemainingQuota,
} from "../src/lib/public-promotions.ts";

/**
 * P4.1 (24 Okt 2026): halaman /promo — discoverability kode promo.
 *
 * Logika tampil harus mengikuti logika PENEGAKAN di checkout, kalau tidak,
 * halaman memamerkan kode yang ditolak checkout (atau menyembunyikan kode
 * yang sebenarnya jalan). Yang dijaga test ini: teks benefit, jendela
 * waktu (aturan sama dengan pricing-repository), dan sisa kuota.
 */

test("promotionBenefitText: flat dan persen, format rupiah id-ID", () => {
  /*
   * Pemisah antara "Rp" dan angka bergantung ICU runtime (spasi biasa,
   * NBSP, atau tanpa spasi — pola serupa di test refund: Rp\s?40.000).
   * Jangan dikunci kaku; yang penting nominalnya benar.
   */
  assert.match(
    promotionBenefitText("flat", 1000, null),
    /^Potongan Rp[\s\u00a0]?1\.000$/,
  );
  assert.match(
    promotionBenefitText("flat", 25000, null),
    /^Potongan Rp[\s\u00a0]?25\.000$/,
  );
  assert.equal(promotionBenefitText("percentage", 5, null), "Diskon 5%");
  assert.match(
    promotionBenefitText("percentage", 12.5, 3000),
    /^Diskon 12,5% \(maks Rp[\s\u00a0]?3\.000\)$/,
    "desimal pakai koma, batas maksimum ikut tampil",
  );
});

test("promotionWindow: aturan yang sama dengan checkout", () => {
  const now = new Date("2026-10-24T12:00:00Z");

  assert.equal(isPromotionWindowActive(null, null, now), true, "tanpa jendela = selalu");
  assert.equal(
    isPromotionWindowActive("2026-10-20T00:00:00Z", "2026-10-31T00:00:00Z", now),
    true,
    "di dalam jendela",
  );
  assert.equal(
    isPromotionWindowActive("2026-10-25T00:00:00Z", null, now),
    false,
    "belum mulai -> tidak boleh tampil",
  );
  assert.equal(
    isPromotionWindowActive(null, "2026-10-24T12:00:00Z", now),
    false,
    "ends_at sudah lewat (batas == sekarang dianggap selesai, sama dengan penegakan)",
  );
});

test("sisa kuota: null = tak terbatas, 0 = habis, tidak pernah negatif", () => {
  assert.equal(promotionRemainingQuota(null, 500), null);
  assert.equal(promotionRemainingQuota(100, 3), 97);
  assert.equal(promotionRemainingQuota(10, 10), 0, "pas habis");
  assert.equal(promotionRemainingQuota(5, 9), 0, "negatif dipotong jadi 0");
});

test("fetch publik: hanya promo aktif + jendela sekarang + data aman", () => {
  const lib = readFileSync("src/lib/public-promotions.ts", "utf8");

  assert.ok(
    lib.includes('filters: { active: "eq.true" }'),
    "hanya promo yang admin nyalakan",
  );
  assert.ok(
    lib.includes("isPromotionWindowActive(row.starts_at, row.ends_at, now)"),
    "jendela waktu dicek sebelum promo tampil",
  );
  assert.ok(
    lib.includes('status: "in.(reserved,redeemed)"'),
    "kuota terpakai dihitung dari reserved + redeemed — order in-flight juga memakan kuota",
  );
  assert.ok(
    lib.includes("return [];"),
    "gagal baca database -> daftar kosong, bukan error di halaman marketing",
  );

  // Bentuk yang diekspos tidak membocorkan kolom internal.
  const shapeMatch = lib.match(
    /return \{[\s\S]*?code: row\.code[\s\S]*?\n    \};/,
  );
  assert.ok(shapeMatch, "bentuk PublicPromotion harus terbaca");
  for (const secret of ["created_at", "updated_at", "active:"]) {
    assert.ok(
      !shapeMatch[0].includes(secret),
      `${secret} tidak boleh ikut ke publik`,
    );
  }
});

test("halaman /promo: kartu dengan salin kode, empty state, SEO", () => {
  const page = readFileSync("src/app/promo/page.tsx", "utf8");

  assert.ok(
    page.includes('export const dynamic = "force-dynamic"'),
    "force-dynamic: nonce CSP + jendela promo tidak boleh ter-cache statis",
  );
  assert.ok(
    page.includes("CopyButton"),
    "kode tinggal disalin — pakai komponen yang sama dengan affiliate",
  );
  assert.ok(
    page.includes("Belum ada promo yang sedang berjalan"),
    "empty state yang jujur",
  );
  assert.ok(
    page.includes("Kuota promo ini sudah habis"),
    "kuota habis tetap tampil dengan penjelasan — bukan hilang misterius",
  );
  assert.ok(
    page.includes("Berlaku untuk semua produk"),
    "promo tanpa target produk = semua produk (aturan checkout)",
  );
  assert.ok(
    page.includes('title: `Promo Aktif — ${BRAND.name}`'),
    "metadata halaman untuk SEO",
  );
});

test("discoverability: link promo di footer, checkout, dan sitemap", () => {
  const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");
  const topup = readFileSync("src/components/TopupExperience.tsx", "utf8");
  const sitemap = readFileSync("src/app/sitemap.ts", "utf8");

  assert.ok(
    footer.includes('href="/promo"'),
    "footer: kolom Jelajahi menampilkan Promo",
  );
  assert.ok(
    topup.includes('href="/promo"'),
    "checkout: kolom promo punya link ke halaman promo",
  );
  assert.ok(
    sitemap.includes("${BASE_URL}/promo"),
    "sitemap: /promo terindeks",
  );
});
