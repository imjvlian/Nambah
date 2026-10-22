import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  decideTier2Commission,
  parseReferralCodeCookie,
} from "../src/lib/affiliate-upline.ts";

/**
 * Affiliate Tier 2 / upline (P2, 22 Okt 2026).
 *
 * Keputusan uang di sini adalah kebijakan, bukan detail teknis — makanya
 * fungsinya murni dan diuji langsung: guard B1/B2/B5 harus bisa dibuktikan
 * tanpa database. Bagian yang menyentuh DB (chain lookup, snapshot order)
 * dijaga lewat source-assertion + rekonsiliasi.
 */

const DASAR = {
  tier1Code: "BUDI",
  tier1Commission: 2000,
  uplineCode: "SENIORBUDI",
  uplineUserId: "uuid-upline",
  uplineIsBuyer: false,
  rate: 0.1,
  netProfitBeforeAffiliate: 10_000,
} as const;

test("happy path: upline menerima 10% dari laba bersih — basis sama dengan tier-1", () => {
  const result = decideTier2Commission({ ...DASAR });

  assert.ok(result, "upline + kode + guard lolos -> snapshot tier-2 harus ada");
  assert.equal(result.code, "SENIORBUDI", "penerima komisi adalah kode upline");
  assert.equal(result.rate, 0.1);
  assert.equal(result.commission, 1000, "10% dari 10.000 = 1.000");
});

test("B1: amount = floor(netProfit * rate), dibulatkan TURUN ke rupiah", () => {
  const result = decideTier2Commission({
    ...DASAR,
    netProfitBeforeAffiliate: 9_999,
  });

  assert.equal(result?.commission, 999, "9.999 * 0.1 = 999.9 -> 999");
});

test("B2: tanpa komisi tier-1 tidak ada tier-2", () => {
  const komisiNol = decideTier2Commission({
    ...DASAR,
    tier1Commission: 0,
  });
  const tanpaKode = decideTier2Commission({
    ...DASAR,
    tier1Code: null,
  });

  assert.equal(komisiNol, null, "tier-1 komisinya 0 (cooldown/margin) -> tier-2 mati");
  assert.equal(tanpaKode, null, "order tanpa kode affiliate tidak punya tier-2");
});

test("B2 turunannya: minimum order, stacking, dan margin menutup tier-2 otomatis", () => {
  /*
   * Guard tier-1 sudah mematikan komisi tier-1 untuk kondisi itu; komisi 0
   * di uji sebelumnya menutup semuanya. Yang diuji di sini: tier-2 tidak
   * punya pintu sendiri yang bisa kebuka saat tier-1 tertutup.
   */
  const result = decideTier2Commission({
    ...DASAR,
    tier1Commission: 0,
    netProfitBeforeAffiliate: 50_000,
  });

  assert.equal(result, null, "netProfit besar sekalipun, tier-1 nol = tier-2 nol");
});

test("D1: tanpa upline atau upline tanpa kode aktif -> null", () => {
  assert.equal(
    decideTier2Commission({ ...DASAR, uplineUserId: null }),
    null,
    "pemilik kode tidak punya referred_by_id",
  );
  assert.equal(
    decideTier2Commission({ ...DASAR, uplineCode: null }),
    null,
    "upline tidak punya kode aktif",
  );
});

test("jaringan rusak: upline = kode yang sama dengan tier-1 -> diam", () => {
  const result = decideTier2Commission({
    ...DASAR,
    uplineCode: "BUDI",
  });

  assert.equal(result, null);
});

test("B5: upline ternyata pembeli order itu sendiri -> tier-2 = 0", () => {
  const result = decideTier2Commission({
    ...DASAR,
    uplineIsBuyer: true,
  });

  assert.equal(
    result,
    null,
    "A merekrut B lalu beli lewat kode B: A tidak boleh komisi dari pembeliannya sendiri",
  );
});

test("rate nol atau margin tidak menghasilkan nominal -> null", () => {
  assert.equal(decideTier2Commission({ ...DASAR, rate: 0 }), null);
  assert.equal(
    decideTier2Commission({ ...DASAR, netProfitBeforeAffiliate: 4 }),
    null,
    "4 * 0.1 = 0.4 -> floor 0 -> bukan komisi",
  );
  assert.equal(
    decideTier2Commission({ ...DASAR, netProfitBeforeAffiliate: -5_000 }),
    null,
    "margin negatif tidak pernah menghasilkan komisi",
  );
});

test("parseReferralCodeCookie: menemukan nambah_ref_code di antara cookie lain", () => {
  const header =
    "nambah_ref_sid=abc123; nambah_ref_code=juniawan; theme=dark; x=y";
  assert.equal(parseReferralCodeCookie(header), "JUNIAWAN");

  assert.equal(parseReferralCodeCookie(null), "");
  assert.equal(parseReferralCodeCookie(""), "");
  assert.equal(
    parseReferralCodeCookie("theme=dark; session=xyz"),
    "",
    "tanpa cookie kode -> kosong, bukan error",
  );
  assert.equal(
    parseReferralCodeCookie("nambah_ref_code=BUDI%20EXTRA"),
    "BUDI EXTRA",
    "nilai URL-encoded didecode",
  );
});

/*
 * ── Bagian DB: source-assertion (gaya rumah) ────────────────────────────
 */

test("migrasi 060: kolom pohon, tier, unique composite — dan drop unique lama PALING AKHIR", () => {
  const sql = readFileSync(
    "supabase/migrations/20261022_060_affiliate_tier2.sql",
    "utf8",
  );

  assert.ok(sql.includes("referred_by_id uuid"), "D1: kolom pohon upline");
  assert.ok(
    sql.includes("referred_by_id <> user_id"),
    "profil tidak boleh jadi upline dirinya sendiri",
  );
  assert.ok(
    sql.includes("tier smallint not null default 1"),
    "D3: kolom tier, baris lama otomatis tier 1",
  );
  assert.ok(
    sql.includes("unique (order_id, tier)"),
    "D3: satu baris per (order, tier)",
  );
  assert.ok(
    sql.includes("commissions_order_id_key"),
    "unique order_id tunggal dilepas",
  );
  assert.ok(
    sql.indexOf("commissions_order_tier_key") <
      sql.indexOf("drop constraint if exists commissions_order_id_key"),
    "unique composite harus berdiri SEBELUM drop yang lama — kode lama tetap aman selama mungkin",
  );
  assert.ok(
    sql.includes("affiliate_tier2_rate"),
    "B4: rate configurable di app_settings",
  );
});

test("orders route: snapshot tier-2 dibekukan + nambah_profit memotong tier-2", () => {
  const route = readFileSync("src/app/api/orders/route.ts", "utf8");

  assert.ok(route.includes("resolveTier2ForOrder"), "resolusi tier-2 dipanggil");
  assert.ok(
    route.indexOf("resolveTier2ForOrder") < route.indexOf('supabaseInsert("orders"'),
    "resolusi SEBELUM insert — snapshot dibekukan sekali",
  );
  assert.ok(route.includes("tier2_affiliate_code: tier2?.code ?? null"));
  assert.ok(
    route.includes("nambah_profit: pricing.nambahProfit - (tier2?.commission ?? 0)"),
    "laba toko tidak boleh mencatat uang yang sudah dibayarkan ke upline",
  );
});

test("commission-service: baris kedua pakai konflik (order_id, tier) dan B2 dijaga", () => {
  const service = readFileSync("src/lib/commission-service.ts", "utf8");

  assert.ok(
    service.includes('onConflict: "order_id,tier"'),
    "upsert per (order, tier) — bukan order_id saja",
  );
  assert.ok(
    service.includes("snapshot.tier === 2 && !(tiers[0].amount > 0)"),
    "B2: tier-2 dilewati kalau komisi tier-1 nol",
  );
  assert.ok(
    service.includes("status: \"in.(pending,available)\""),
    "pembatalan refund/gagal by order_id menutup kedua tier sekaligus",
  );
  assert.ok(
    service.indexOf("tier: \"eq.1\"") > 0,
    "kontrak return lama dipertahankan (baris tier-1)",
  );
});

test("rekonsiliasi keuangan: expected nambah memotong tier-2 + cek ledger upline", () => {
  const lib = readFileSync("src/lib/financial-reconciliation.ts", "utf8");

  assert.ok(
    lib.includes("expectedNetProfit - expectedAffiliateCommission - expectedTier2Commission"),
    "nambah_profit dihitung setelah KEDUA komisi",
  );
  assert.ok(
    lib.includes("tier2_commission_mismatch"),
    "snapshot tier-2 yang tidak cocok rate-nya harus terdeteksi",
  );
  assert.ok(
    lib.includes("tier2_without_tier1"),
    "snapshot rusak: tier-2 tanpa tier-1",
  );
  assert.ok(
    lib.includes("order: \"tier.asc\""),
    "ledger diurut per tier supaya index 1 selalu baris upline",
  );
  assert.ok(
    lib.includes("tier2_commission_missing"),
    "ledger upline hilang = error, bukan senyap",
  );
});

test("profil: atribusi upline first-touch menang, dari cookie link /r/", () => {
  const route = readFileSync("src/app/api/account/profile/route.ts", "utf8");

  assert.ok(
    route.includes("captureReferredByFromCookieHeader"),
    "penyimpanan profil menangkap cookie kode affiliate",
  );
  assert.ok(
    route.includes("currentReferredBy: existingProfile?.referred_by_id ?? null"),
    "upline yang sudah ada dikirim sebagai penanda first-touch",
  );
  assert.ok(
    route.indexOf("captureReferredByFromCookieHeader") <
      route.indexOf("supabaseUpsert("),
    "resolusi dilakukan sebelum upsert profil",
  );
});

test("guard anti self-referral diekspor ulang untuk B5", () => {
  const repo = readFileSync("src/lib/pricing-repository.ts", "utf8");

  assert.ok(
    repo.includes("export async function affiliateOwnedByBuyer"),
    "affiliate-upline memakai identitas yang sama dengan P1.1/P1.2",
  );
});

test("captureReferredByFromCookieHeader: first-touch — upline lama tidak pernah ditimpa", () => {
  const lib = readFileSync("src/lib/affiliate-upline.ts", "utf8");

  assert.ok(
    lib.includes("if (currentReferredBy) return null;"),
    "profil yang sudah punya upline tidak ditimpa simpanan berikutnya",
  );
});
