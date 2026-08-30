import type { GamePackage, PaymentMethod } from "@/lib/catalog";

export const DEFAULT_AFFILIATE_RATE = 0.2;
export const MINIMUM_NAMBAH_PROFIT = 500;

export type Promotion = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number;
  minimumOrder: number;
  maxDiscount?: number;
};

export const promotions: Promotion[] = [
  {
    code: "WELCOME",
    name: "Promo pengguna baru",
    type: "flat",
    value: 1000,
    minimumOrder: 20000,
  },
  {
    code: "NAMB5",
    name: "Diskon 5%",
    type: "percentage",
    value: 5,
    minimumOrder: 25000,
    maxDiscount: 3000,
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

export function calculatePricing({
  item,
  paymentMethod,
  promotion,
  hasAffiliate,
  affiliateRate = DEFAULT_AFFILIATE_RATE,
  minimumNambahProfit = MINIMUM_NAMBAH_PROFIT,
}: {
  item: GamePackage;
  paymentMethod: PaymentMethod;
  promotion: Promotion | null;
  hasAffiliate: boolean;
  affiliateRate?: number;
  minimumNambahProfit?: number;
}): PricingResult {
  const promo = calculatePromotionDiscount(item.sellingPrice, promotion);
  const discountedSubtotal = Math.max(0, item.sellingPrice - promo.amount);

  const customerPaymentFee =
    paymentMethod.customerFeeFlat + percentageOf(discountedSubtotal, paymentMethod.customerFeePercent);
  const finalPrice = discountedSubtotal + customerPaymentFee;

  const merchantPaymentCost =
    paymentMethod.merchantFeeFlat + percentageOf(finalPrice, paymentMethod.merchantFeePercent);

  const netProfitBeforeAffiliate = finalPrice - item.supplierCost - merchantPaymentCost;
  const affiliateCommission = hasAffiliate
    ? Math.max(0, Math.floor(netProfitBeforeAffiliate * affiliateRate))
    : 0;
  const nambahProfit = netProfitBeforeAffiliate - affiliateCommission;

  let rejectionReason = promo.rejectionReason;
  if (!rejectionReason && nambahProfit < minimumNambahProfit) {
    rejectionReason = `Promo atau biaya transaksi membuat profit Nambah di bawah batas minimum ${formatIDR(minimumNambahProfit)}.`;
  }

  return {
    supplierCost: item.supplierCost,
    sellingPrice: item.sellingPrice,
    referencePrice: item.referencePrice,
    referenceDiscountPercent: getReferenceDiscountPercent(item.referencePrice, item.sellingPrice),
    promoCode: promotion?.code ?? null,
    promoName: promotion?.name ?? null,
    promotionDiscount: promo.amount,
    customerPaymentFee,
    merchantPaymentCost,
    finalPrice,
    netProfitBeforeAffiliate,
    affiliateRate: hasAffiliate ? affiliateRate : 0,
    affiliateCommission,
    nambahProfit,
    minimumNambahProfit,
    safeToCheckout: rejectionReason === null,
    rejectionReason,
  };
}
