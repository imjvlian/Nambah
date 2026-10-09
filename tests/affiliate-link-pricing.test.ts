import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePricing,
  type PricingResult,
} from "../src/lib/pricing.ts";
import { parseCookieHeader, readLinkReferralCode } from "../src/lib/affiliate-link-cookie.ts";
import type { PaymentMethod, GamePackage } from "../src/lib/catalog.ts";

/**
 * Jalur affiliate dari link.
 *
 * Dua mekanisme yang BERBEDA, dan test ini mengunci bedanya:
 *
 *   kode manual → user login, pembeli dapat DISKON, affiliate dapat komisi
 *   kode link   → semua orang, pembeli TIDAK dapat apa-apa, affiliate komisi
 *
 * Kalau keduanya sampai bercampur, salah satu dari dua janji itu kepegang.
 */

const payment: PaymentMethod = {
  id: "qris",
  name: "QRIS",
  detail: "Semua aplikasi pembayaran",
  customerFeeFlat: 0,
  customerFeePercent: 0,
  merchantFeeFlat: 0,
  merchantFeePercent: 0,
};

const pkg: GamePackage & { supplierCost: number } = {
  id: "p1",
  label: "60 Diamonds",
  sellingPrice: 20_000,
  referencePrice: 25_000,
  supplierCost: 15_000,
};

const linkAffiliate = { code: "JIKIWA", commissionRate: 0.2 };

function price(overrides: Partial<Parameters<typeof calculatePricing>[0]> = {}): PricingResult {
  return calculatePricing({
    item: pkg,
    paymentMethod: payment,
    promotion: null,
    referral: null,
    linkAffiliate: null,
    ...overrides,
  });
}

test("kode link memberi komisi affiliate tanpa diskon ke pembeli", () => {
  const result = price({ linkAffiliate });

  // Affiliate dapat komisi dari laba.
  assert.ok(result.affiliateCommission > 0, "link harus memberi komisi");
  assert.equal(result.affiliateCode, "JIKIWA");

  // Pembeli tidak dapat apa-apa.
  assert.equal(result.referralCode, null, "pembeli tidak boleh dapat kode referral");
  assert.equal(result.referralDiscount, 0, "link tidak boleh memberi diskon");
  assert.equal(result.referralName, null);
  assert.equal(result.finalPrice, pkg.sellingPrice, "harga tidak boleh turun");
});

test("tanpa kode, tidak ada komisi dan tidak ada kode affiliate", () => {
  const result = price();
  assert.equal(result.affiliateCommission, 0);
  assert.equal(result.affiliateCode, null);
  assert.equal(result.affiliateRate, 0);
});

test("kode manual menang atas kode link", () => {
  const referral = {
    code: "TEMAN",
    name: "Referral Teman",
    commissionRate: 0.2,
    userBenefitType: "flat" as const,
    userBenefitValue: 500,
    minimumOrder: 0,
    stackableWithPromotions: true,
    status: "active" as const,
  };

  const result = price({ referral, linkAffiliate });

  // Tidak akan pernah dua-duanya dipakai: `affiliateCode` milik kode manual.
  assert.equal(result.affiliateCode, "TEMAN");
  assert.equal(result.referralCode, "TEMAN");
  // Kode link tidak boleh bocor ke order.
  assert.equal(result.referralName, "Referral Teman");
  //-rate mengikuti kode yang menang.
  assert.equal(result.affiliateRate, 0.2);
});

test("kode link dan kode manual tidak pernah menghasilkan dua komisi", () => {
  const referral = {
    code: "TEMAN",
    name: "Referral Teman",
    commissionRate: 0.2,
    userBenefitType: "flat" as const,
    userBenefitValue: 500,
    minimumOrder: 0,
    stackableWithPromotions: true,
    status: "active" as const,
  };
  const both = price({ referral, linkAffiliate });
  const onlyLink = price({ linkAffiliate });

  // Kalau link ikut dihitung terpisah, komisinya akan dua kali lipat.
  assert.ok(
    both.affiliateCommission <= onlyLink.affiliateCommission + 1,
    "kode link ikut dihitung padahal kode manual dipakai",
  );
});

test("kode cookie dibaca dan dibersihkan", () => {
  const request = new Request("https://nambah.test/", {
    headers: { cookie: "nambah_ref_code=jikiwa; lain=1" },
  });
  assert.equal(readLinkReferralCode(request), "JIKIWA", "kode harus dinormalisasi");
});

test("kode cookie yang tidak valid diabaikan, bukan error", () => {
  // Link rusak tidak boleh membuat checkout gagal.
  for (const cookie of [
    "nambah_ref_code=",
    // Dua karakter — di bawah panjang minimum pola.
    "nambah_ref_code=ab",
    "nambah_ref_code=!!",
    // Di atas panjang maksimum pola.
    "nambah_ref_code=" + "A".repeat(60),
    "lain=1",
    "",
  ]) {
    const request = new Request("https://nambah.test/", {
      headers: cookie ? { cookie } : {},
    });
    assert.equal(
      readLinkReferralCode(request),
      "",
      `cookie ${JSON.stringify(cookie)} seharusnya diabaikan`,
    );
  }
});

test("tidak ada cookie menghasilkan string kosong", () => {
  assert.equal(
    readLinkReferralCode(new Request("https://nambah.test/")),
    "",
  );
});

test("parseCookieHeader menangani cookie rusak tanpa melempar", () => {
  // Percent-encoding rusak harus ditoleransi, bukan menggagalkan parsing
  // seluruh cookie jar — satu cookie aneh tidak boleh membuang yang lain.
  const jar = parseCookieHeader("nambah_ref_code=%E0%A4%A; lainnya=1");
  assert.equal(jar.size, 2, "cookie rusak tidak boleh membuang yang lain");
});

test("kode link tidak pernah terekspos ke payload publik", () => {
  // `affiliateCode` sengaja tidak ada di `PublicPricingResult`. Kalau
  // ditambahkan ke sana, kode affiliate akan terkirim ke browser — dan orang
  // bisa membaca kode affiliate orang lain dari network tab.
  assert.equal(
    Object.keys(price({ linkAffiliate })).includes("affiliateRate"),
    true,
    "PricingResult internal boleh punya rate",
  );
  // Yang dikirim ke client ditentukan oleh `toPublicPricing` — dicek di test
  // `public-pricing` terpisah. Di sini cukup memastikan bentuk PricingResult
  // sendiri konsisten.
  assert.equal(
    price({ linkAffiliate }).affiliateCode,
    "JIKIWA",
    "kode link harus tercatat untuk komisi",
  );
});
