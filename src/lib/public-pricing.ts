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
  | "customerPaymentFee"
  | "finalPrice"
  | "safeToCheckout"
  | "rejectionReason"
>;

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
    customerPaymentFee: 0,
    finalPrice: item.sellingPrice,
    safeToCheckout: true,
    rejectionReason: null,
  };
}
