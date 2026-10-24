import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * P4.3 (24 Okt 2026): landing publik program afiliasi.
 *
 * Panel afiliasi (daftar + komisi + pencairan) sudah ada di /account —
 * yang hilang adalah halaman yang MENJUAL programnya ke orang yang
 * belum jadi mitra. Yang dijaga test ini: janji marketing tidak boleh
 * lebih besar dari kenyataan sistem.
 */

test("landing tidak menjanjikan rate yang sistem tidak pegang", () => {
  const page = readFileSync("src/app/afiliasi/page.tsx", "utf8");

  // Tier-1 final ditentukan admin saat approve (kebijakan panel join:
  // "Rate komisinya ditentukan admin setelah pengajuan kamu ditinjau").
  // Landing harus bilang "hingga", bukan angka pasti.
  assert.ok(
    page.includes("hingga {tier1Percent}%"),
    "tier-1 diberi kata 'hingga' — rate final keputusan admin",
  );
  assert.ok(
    page.includes("DEFAULT_AFFILIATE_RATE"),
    "angka tier-1 dari konstanta sistem, bukan hardcode marketing",
  );

  // Tier-2 global live dari app_settings — halaman ikut berubah saat
  // admin mengubahnya, tidak perlu deploy ulang.
  assert.ok(
    page.includes("getAffiliateTier2Rate()"),
    "tier-2 dibaca live dari app_settings",
  );
});

test("landing jujur soal dasar perhitungan komisi", () => {
  const page = readFileSync("src/app/afiliasi/page.tsx", "utf8");

  // Komisi dari PROFIT, bukan nominal tagihan — halaman yang mengklaim
  // "20% dari belanja" akan melahirkan sengketa dengan mitra.
  assert.ok(
    page.includes("profit eligible"),
    "basis perhitungan dinyatakan eksplisit",
  );
  assert.ok(
    page.includes("bukan dari nominal"),
    "ditegaskan bukan dari nominal tagihan",
  );
  // Tier-2 dibayar toko — bukan dipotong dari komisi mitra (keputusan P2).
  assert.ok(
    page.includes("dibayar oleh toko"),
    "sumber bonus rekrut dinyatakan",
  );
  // Minimal pencairan dari settings yang sama dengan panel akun (P1.4).
  assert.ok(
    page.includes("eq.affiliate_min_payout"),
    "minimal pencairan dari sumber yang sama dengan panel akun",
  );
});

test("alur bergabung yang dijelaskan = alur yang benar-benar ada", () => {
  const page = readFileSync("src/app/afiliasi/page.tsx", "utf8");
  const joinPanel = readFileSync(
    "src/components/AffiliateJoinPanel.tsx",
    "utf8",
  );
  const account = readFileSync("src/components/AccountDashboard.tsx", "utf8");

  // Langkah yang dipromosikan harus sesuai mekanisme nyata:
  // akun -> formulir pengajuan (nama, WA, channel) -> review admin -> kode.
  assert.ok(
    page.includes("formulir afiliasi"),
    "landing menyebut formulir pengajuan",
  );
  assert.ok(
    page.includes("meninjau"),
    "menyebut proses review admin — bukan 'langsung aktif'",
  );
  assert.ok(
    joinPanel.includes("/api/account/affiliate-request"),
    "formulir pengajuan memang ada di panel akun",
  );
  assert.ok(
    joinPanel.includes("Rate komisinya ditentukan admin"),
    "panel join konsisten: rate ditentukan admin",
  );
  assert.ok(
    account.includes("AffiliateJoinPanel"),
    "panel join memang dirender di dashboard akun",
  );

  // CTA mengarah ke alur yang benar.
  assert.ok(
    page.includes('href="/register"'),
    "CTA utama ke pendaftaran akun",
  );
  assert.ok(
    page.includes('href="/login?next=%2Faccount"'),
    "CTA kedua masuk langsung ke dashboard akun",
  );
});

test("force-dynamic + metadata + discoverability", () => {
  const page = readFileSync("src/app/afiliasi/page.tsx", "utf8");
  const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");
  const sitemap = readFileSync("src/app/sitemap.ts", "utf8");

  assert.ok(
    page.includes('export const dynamic = "force-dynamic"'),
    "nonce CSP + rate live — tidak boleh ter-cache statis",
  );
  assert.ok(
    page.includes("title: `Program Afiliasi — ${BRAND.name}`"),
    "metadata untuk SEO",
  );
  assert.ok(
    footer.includes('href="/afiliasi"'),
    "footer: link Afiliasi",
  );
  assert.ok(
    sitemap.includes("${BASE_URL}/afiliasi"),
    "sitemap: /afiliasi terindeks",
  );
});
