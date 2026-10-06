import type { PaymentMethod } from "@/lib/catalog";
import {
  POINT_VALUE_IDR,
  calculateEarnedPoints,
} from "@/lib/loyalty";
import type { ReferralProgram } from "@/lib/referrals";
import type { SupplierPricedPackage } from "@/lib/supplier-pricing";
import { rejectionCodeCopy, type RejectionCode } from "@/lib/user-copy";

export const DEFAULT_AFFILIATE_RATE = 0.2;
export const MINIMUM_NAMBAH_PROFIT = 500;

export type Promotion = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number;
  minimumOrder: number;
  maxDiscount?: number;
  stackableWithReferral?: boolean;
};

export const promotions: Promotion[] = [
  {
    code: "WELCOME",
    name: "Promo pengguna baru",
    type: "flat",
    value: 1000,
    minimumOrder: 20000,
    stackableWithReferral: true,
  },
  {
    code: "NAMB5",
    name: "Diskon 5%",
    type: "percentage",
    value: 5,
    minimumOrder: 25000,
    maxDiscount: 3000,
    stackableWithReferral: true,
  },
];

export type PricingResult = {
  supplierCost: number;
  sellingPrice: number;
  referencePrice: number;
  referenceDiscountPercent: number;
  promoCode: string | null;
  promoName: string | null;
  promotionDiscount: number;
  referralCode: string | null;
  referralName: string | null;
  referralRequestedDiscount: number;
  referralDiscount: number;
  referralDiscountCapped: boolean;
  pointsDiscount: number;
  pointsRedeemed: number;
  pointsEarned: number;
  pointsRewardValue: number;
  loyaltyEligibleSpend: number;
  customerPaymentFee: number;
  merchantPaymentCost: number;
  finalPrice: number;
  netProfitBeforeAffiliate: number;
  affiliateRate: number;
  affiliateCommission: number;
  nambahProfit: number;
  minimumNambahProfit: number;
  safeToCheckout: boolean;
  rejectionReason: string | null;
  /**
   * Kode alasan stabil untuk log/reconciliation server-side.
   * `rejectionReason` sudah aman untuk user; kode ini yang dipakai developer
   * ketika perlu tahu penyebab bisnis tanpa membocorkan angka profit/margin.
   */
  rejectionCode: RejectionCode | null;
};

function percentageOf(amount: number, percentage: number) {
  return Math.round(amount * (percentage / 100));
}

export function formatIDR(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function roundUpToHundred(value: number) {
  return Math.ceil(Math.max(0, value) / 100) * 100;
}

/**
 * Harga saran dari modal supplier — rumus yang sama dengan endpoint
 * /api/admin/catalog/markup: jual = max(Rp100, modal×(1+markup), modal+profit
 * minimum), coret = jual×(1+markup coret), semuanya dibulatkan ke atas Rp100.
 */
export function suggestPriceFromCost({
  cost,
  sellingMarkupPercent = 5,
  referenceMarkupPercent = 10,
  minimumProfit = MINIMUM_NAMBAH_PROFIT,
}: {
  cost: number;
  sellingMarkupPercent?: number;
  referenceMarkupPercent?: number;
  minimumProfit?: number;
}): { sellingPrice: number; referencePrice: number } {
  const percentagePrice = roundUpToHundred(cost * (1 + sellingMarkupPercent / 100));
  const minimumSafePrice = roundUpToHundred(cost + minimumProfit);
  const sellingPrice = Math.max(100, percentagePrice, minimumSafePrice);
  const referencePrice = Math.max(
    sellingPrice,
    roundUpToHundred(sellingPrice * (1 + referenceMarkupPercent / 100)),
  );
  return { sellingPrice, referencePrice };
}

export function getReferenceDiscountPercent(referencePrice: number, sellingPrice: number) {
  if (referencePrice <= sellingPrice || referencePrice <= 0) return 0;
  return Math.round(((referencePrice - sellingPrice) / referencePrice) * 100);
}

export function findPromotion(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  return promotions.find((promotion) => promotion.code === normalized) ?? null;
}

function calculatePromotionDiscount(sellingPrice: number, promotion: Promotion | null) {
  if (!promotion) {
    return {
      amount: 0,
      rejectionReason: null as string | null,
      rejectionCode: null as RejectionCode | null,
    };
  }

  if (sellingPrice < promotion.minimumOrder) {
    return {
      amount: 0,
      rejectionReason: rejectionCodeCopy("promo_minimum_order", {
        code: promotion.code,
        minimumOrder: formatIDR(promotion.minimumOrder),
      }),
      rejectionCode: "promo_minimum_order" as const,
    };
  }

  const rawDiscount =
    promotion.type === "flat"
      ? promotion.value
      : percentageOf(sellingPrice, promotion.value);

  return {
    amount: promotion.maxDiscount ? Math.min(rawDiscount, promotion.maxDiscount) : rawDiscount,
    rejectionReason: null as string | null,
    rejectionCode: null as RejectionCode | null,
  };
}

function calculateReferralRequestedDiscount(
  sellingPrice: number,
  referral: ReferralProgram | null,
  promotion: Promotion | null,
) {
  if (!referral) {
    return {
      amount: 0,
      rejectionReason: null as string | null,
      rejectionCode: null as RejectionCode | null,
    };
  }

  if (sellingPrice < referral.minimumOrder) {
    return {
      amount: 0,
      rejectionReason: rejectionCodeCopy("referral_minimum_order", {
        code: referral.code,
        minimumOrder: formatIDR(referral.minimumOrder),
      }),
      rejectionCode: "referral_minimum_order" as const,
    };
  }

  if (
    promotion &&
    (promotion.stackableWithReferral === false || referral.stackableWithPromotions === false)
  ) {
    return {
      amount: 0,
      rejectionReason: rejectionCodeCopy("referral_not_stackable", {
        code: referral.code,
        otherCode: promotion.code,
      }),
      rejectionCode: "referral_not_stackable" as const,
    };
  }

  const rawDiscount =
    referral.userBenefitType === "flat"
      ? referral.userBenefitValue
      : percentageOf(sellingPrice, referral.userBenefitValue);

  return {
    amount: referral.maxUserBenefit
      ? Math.min(rawDiscount, referral.maxUserBenefit)
      : rawDiscount,
    rejectionReason: null as string | null,
    rejectionCode: null as RejectionCode | null,
  };
}

function evaluatePrice({
  item,
  paymentMethod,
  promotionDiscount,
  referralDiscount,
  pointsDiscount,
  affiliateRate,
  loyaltyEligible,
}: {
  item: SupplierPricedPackage;
  paymentMethod: PaymentMethod;
  promotionDiscount: number;
  referralDiscount: number;
  pointsDiscount: number;
  affiliateRate: number;
  loyaltyEligible: boolean;
}) {
  const loyaltyEligibleSpend = Math.max(
    0,
    item.sellingPrice - promotionDiscount - referralDiscount - pointsDiscount,
  );

  const pointsEarned = loyaltyEligible
    ? calculateEarnedPoints(loyaltyEligibleSpend)
    : 0;
  const pointsRewardValue = pointsEarned * POINT_VALUE_IDR;

  const customerPaymentFee =
    paymentMethod.customerFeeFlat +
    percentageOf(loyaltyEligibleSpend, paymentMethod.customerFeePercent);
  const finalPrice = loyaltyEligibleSpend + customerPaymentFee;

  const merchantPaymentCost =
    paymentMethod.merchantFeeFlat +
    percentageOf(finalPrice, paymentMethod.merchantFeePercent);

  // Earned points are treated as a loyalty liability immediately so referral
  // commission and the minimum-profit guard cannot silently consume the reward.
  const netProfitBeforeAffiliate =
    finalPrice - item.supplierCost - merchantPaymentCost - pointsRewardValue;
  const affiliateCommission =
    affiliateRate > 0
      ? Math.max(0, Math.floor(netProfitBeforeAffiliate * affiliateRate))
      : 0;
  const nambahProfit = netProfitBeforeAffiliate - affiliateCommission;

  return {
    loyaltyEligibleSpend,
    pointsEarned,
    pointsRewardValue,
    customerPaymentFee,
    finalPrice,
    merchantPaymentCost,
    netProfitBeforeAffiliate,
    affiliateCommission,
    nambahProfit,
  };
}

function capReferralDiscount({
  requestedDiscount,
  minimumNambahProfit,
  evaluate,
}: {
  requestedDiscount: number;
  minimumNambahProfit: number;
  evaluate: (discount: number) => ReturnType<typeof evaluatePrice>;
}) {
  if (requestedDiscount <= 0) return 0;
  if (evaluate(requestedDiscount).nambahProfit >= minimumNambahProfit) {
    return requestedDiscount;
  }

  let low = 0;
  let high = requestedDiscount;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (evaluate(mid).nambahProfit >= minimumNambahProfit) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

export function calculatePricing({
  item,
  paymentMethod,
  promotion,
  referral,
  pointsDiscount = 0,
  loyaltyEligible = false,
  minimumNambahProfit = MINIMUM_NAMBAH_PROFIT,
}: {
  item: SupplierPricedPackage;
  paymentMethod: PaymentMethod;
  promotion: Promotion | null;
  referral: ReferralProgram | null;
  pointsDiscount?: number;
  loyaltyEligible?: boolean;
  minimumNambahProfit?: number;
}): PricingResult {
  const normalizedPointsDiscount =
    Number.isInteger(pointsDiscount) && pointsDiscount > 0
      ? pointsDiscount
      : 0;
  const promo = calculatePromotionDiscount(item.sellingPrice, promotion);
  const referralBenefit = calculateReferralRequestedDiscount(
    item.sellingPrice,
    referral,
    promotion,
  );
  const affiliateRate = referral?.commissionRate ?? 0;

  const evaluate = (referralDiscount: number) =>
    evaluatePrice({
      item,
      paymentMethod,
      promotionDiscount: promo.amount,
      referralDiscount,
      pointsDiscount: normalizedPointsDiscount,
      affiliateRate,
      loyaltyEligible,
    });

  const baseEvaluation = evaluate(0);
  const referralDiscount =
    promo.rejectionReason || referralBenefit.rejectionReason
      ? 0
      : capReferralDiscount({
          requestedDiscount: referralBenefit.amount,
          minimumNambahProfit,
          evaluate,
        });

  const finalEvaluation = evaluate(referralDiscount);
  const referralDiscountCapped =
    referralDiscount > 0 && referralDiscount < referralBenefit.amount;

  let rejectionReason = promo.rejectionReason ?? referralBenefit.rejectionReason;
  let rejectionCode: RejectionCode | null =
    promo.rejectionCode ?? referralBenefit.rejectionCode;

  const subtotalBeforePoints = Math.max(
    0,
    item.sellingPrice - promo.amount - referralDiscount,
  );

  if (!rejectionReason && normalizedPointsDiscount > subtotalBeforePoints) {
    rejectionReason = rejectionCodeCopy("points_exceed_subtotal");
    rejectionCode = "points_exceed_subtotal";
  }

  // Penyebab di bawah ini murni internal (profit/margin). Angka ambang tidak
  // boleh sampai ke user — teks generik dipakai, kode disimpan untuk log.
  if (!rejectionReason && baseEvaluation.nambahProfit < minimumNambahProfit) {
    rejectionReason = rejectionCodeCopy("profit_below_minimum");
    rejectionCode = "profit_below_minimum";
  }

  if (
    !rejectionReason &&
    referral &&
    referralBenefit.amount > 0 &&
    referralDiscount === 0
  ) {
    rejectionReason = rejectionCodeCopy("referral_margin_too_thin", {
      code: referral.code,
    });
    rejectionCode = "referral_margin_too_thin";
  }

  return {
    supplierCost: item.supplierCost,
    sellingPrice: item.sellingPrice,
    referencePrice: item.referencePrice,
    referenceDiscountPercent: getReferenceDiscountPercent(
      item.referencePrice,
      item.sellingPrice,
    ),
    promoCode: promotion?.code ?? null,
    promoName: promotion?.name ?? null,
    promotionDiscount: promo.amount,
    referralCode: referral?.code ?? null,
    referralName: referral?.name ?? null,
    referralRequestedDiscount: referralBenefit.amount,
    referralDiscount,
    referralDiscountCapped,
    pointsDiscount: normalizedPointsDiscount,
    pointsRedeemed: Math.floor(normalizedPointsDiscount / POINT_VALUE_IDR),
    pointsEarned: finalEvaluation.pointsEarned,
    pointsRewardValue: finalEvaluation.pointsRewardValue,
    loyaltyEligibleSpend: finalEvaluation.loyaltyEligibleSpend,
    customerPaymentFee: finalEvaluation.customerPaymentFee,
    merchantPaymentCost: finalEvaluation.merchantPaymentCost,
    finalPrice: finalEvaluation.finalPrice,
    netProfitBeforeAffiliate: finalEvaluation.netProfitBeforeAffiliate,
    affiliateRate,
    affiliateCommission: finalEvaluation.affiliateCommission,
    nambahProfit: finalEvaluation.nambahProfit,
    minimumNambahProfit,
    safeToCheckout: rejectionReason === null,
    rejectionReason,
    rejectionCode,
  };
}
