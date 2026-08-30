import type { GamePackage, PaymentMethod } from "@/lib/catalog";
import type { ReferralProgram } from "@/lib/referrals";

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
  if (!promotion) return { amount: 0, rejectionReason: null as string | null };

  if (sellingPrice < promotion.minimumOrder) {
    return {
      amount: 0,
      rejectionReason: `Minimum transaksi untuk ${promotion.code} adalah ${formatIDR(promotion.minimumOrder)}.`,
    };
  }

  const rawDiscount =
    promotion.type === "flat"
      ? promotion.value
      : percentageOf(sellingPrice, promotion.value);

  return {
    amount: promotion.maxDiscount ? Math.min(rawDiscount, promotion.maxDiscount) : rawDiscount,
    rejectionReason: null as string | null,
  };
}

function calculateReferralRequestedDiscount(
  sellingPrice: number,
  referral: ReferralProgram | null,
  promotion: Promotion | null,
) {
  if (!referral) return { amount: 0, rejectionReason: null as string | null };

  if (sellingPrice < referral.minimumOrder) {
    return {
      amount: 0,
      rejectionReason: `Minimum transaksi untuk referral ${referral.code} adalah ${formatIDR(referral.minimumOrder)}.`,
    };
  }

  if (
    promotion &&
    (promotion.stackableWithReferral === false || referral.stackableWithPromotions === false)
  ) {
    return {
      amount: 0,
      rejectionReason: `Referral ${referral.code} tidak dapat digabung dengan promo ${promotion.code}.`,
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
  };
}

function evaluatePrice({
  item,
  paymentMethod,
  promotionDiscount,
  referralDiscount,
  affiliateRate,
}: {
  item: GamePackage;
  paymentMethod: PaymentMethod;
  promotionDiscount: number;
  referralDiscount: number;
  affiliateRate: number;
}) {
  const discountedSubtotal = Math.max(
    0,
    item.sellingPrice - promotionDiscount - referralDiscount,
  );

  const customerPaymentFee =
    paymentMethod.customerFeeFlat +
    percentageOf(discountedSubtotal, paymentMethod.customerFeePercent);
  const finalPrice = discountedSubtotal + customerPaymentFee;

  const merchantPaymentCost =
    paymentMethod.merchantFeeFlat +
    percentageOf(finalPrice, paymentMethod.merchantFeePercent);

  const netProfitBeforeAffiliate = finalPrice - item.supplierCost - merchantPaymentCost;
  const affiliateCommission =
    affiliateRate > 0
      ? Math.max(0, Math.floor(netProfitBeforeAffiliate * affiliateRate))
      : 0;
  const nambahProfit = netProfitBeforeAffiliate - affiliateCommission;

  return {
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
  minimumNambahProfit = MINIMUM_NAMBAH_PROFIT,
}: {
  item: GamePackage;
  paymentMethod: PaymentMethod;
  promotion: Promotion | null;
  referral: ReferralProgram | null;
  minimumNambahProfit?: number;
}): PricingResult {
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
      affiliateRate,
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

  if (!rejectionReason && baseEvaluation.nambahProfit < minimumNambahProfit) {
    rejectionReason = `Biaya transaksi membuat profit Nambah di bawah batas minimum ${formatIDR(minimumNambahProfit)}.`;
  }

  if (
    !rejectionReason &&
    referral &&
    referralBenefit.amount > 0 &&
    referralDiscount === 0
  ) {
    rejectionReason = `Benefit referral ${referral.code} tidak dapat diterapkan pada produk ini karena margin terlalu tipis.`;
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
  };
}
