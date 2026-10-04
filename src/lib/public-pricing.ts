import type { GamePackage } from "@/lib/catalog";
import type { PricingResult } from "@/lib/pricing";

export type PublicPricingResult = Pick<
  PricingResult,
  | "sellingPrice"
  | "referencePrice"
  | "referenceDiscountPercent"
  | "promoCode"
  | "promoName"
  | "promotionDiscount"
  | "referralCode"
  | "referralName"
  | "referralRequestedDiscount"
  | "referralDiscount"
  | "referralDiscountCapped"
  | "pointsDiscount"
  | "pointsRedeemed"
  | "pointsEarned"
  | "customerPaymentFee"
  | "finalPrice"
  | "safeToCheckout"
  | "rejectionReason"
>;

/**
 * Catatan keamanan: `affiliateRate`, `supplierCost`, `nambahProfit`,
 * `netProfitBeforeAffiliate`, `minimumNambahProfit`, dan `rejectionCode`
 * SENGAJA tidak ada di payload ini. Nilai-nilai tersebut hanya boleh keluar
 * lewat endpoint admin/reconciliation yang sudah pakai autentikasi.
 */
export function toPublicPricing(pricing: PricingResult): PublicPricingResult {
  return {
    sellingPrice: pricing.sellingPrice,
    referencePrice: pricing.referencePrice,
    referenceDiscountPercent: pricing.referenceDiscountPercent,
    promoCode: pricing.promoCode,
    promoName: pricing.promoName,
    promotionDiscount: pricing.promotionDiscount,
    referralCode: pricing.referralCode,
    referralName: pricing.referralName,
    referralRequestedDiscount: pricing.referralRequestedDiscount,
    referralDiscount: pricing.referralDiscount,
    referralDiscountCapped: pricing.referralDiscountCapped,
    pointsDiscount: pricing.pointsDiscount,
    pointsRedeemed: pricing.pointsRedeemed,
    pointsEarned: pricing.pointsEarned,
    customerPaymentFee: pricing.customerPaymentFee,
    finalPrice: pricing.finalPrice,
    safeToCheckout: pricing.safeToCheckout,
    rejectionReason: pricing.rejectionReason,
  };
}

export function createPublicPricingFallback(item: GamePackage): PublicPricingResult {
  const referenceDiscountPercent =
    item.referencePrice > item.sellingPrice && item.referencePrice > 0
      ? Math.round(((item.referencePrice - item.sellingPrice) / item.referencePrice) * 100)
      : 0;

  return {
    sellingPrice: item.sellingPrice,
    referencePrice: item.referencePrice,
    referenceDiscountPercent,
    promoCode: null,
    promoName: null,
    promotionDiscount: 0,
    referralCode: null,
    referralName: null,
    referralRequestedDiscount: 0,
    referralDiscount: 0,
    referralDiscountCapped: false,
    pointsDiscount: 0,
    pointsRedeemed: 0,
    pointsEarned: 0,
    customerPaymentFee: 0,
    finalPrice: item.sellingPrice,
    safeToCheckout: true,
    rejectionReason: null,
  };
}
