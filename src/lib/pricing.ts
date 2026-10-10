import type { PaymentMethod } from "@/lib/catalog";
import { MERCHANT_RETAIL_PAYMENT_METHOD_ID } from "@/lib/catalog";
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
  /**
   * Kode affiliate yang dipakai untuk order ini, baik dari kode manual
   * (`referralCode`) maupun dari link.
   *
   * Dipakai untuk `orders.affiliate_code` — kolom yang dibaca
   * `commission-service.ts` untuk menghitung komisi. Kalau order hanya datang
   * dari link, `referralCode` tetap null (pembeli tidak dapat diskon) tapi
   * affiliate tetap harus tercatat di sini, kalau tidak komisinya nol.
   */
  affiliateCode: string | null;
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
  /**
   * Biaya layanan merchant, dalam rupiah. 100% milik merchant — Lacte tidak
   * mengambil apa pun dari nilai ini.
   *
   * Masuk ke `finalPrice` (user membayarnya ke merchant) tapi SENGAJA tidak
   * masuk ke `nambahProfit`. Nilai ini di-snapshot ke
   * `orders.service_fee_amount` supaya piutang merchant bisa direkonsiliasi.
   *
   * Selalu 0 untuk payment method selain `merchant_retail`.
   */
  merchantServiceFee: number;
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
  // Tanpa default yang sama seperti di `calculatePricing`. Fungsi ini sudah
  // dipanggil dari dalam sana dengan nilai yang sudah dinormalisasi, jadi
  // default hanya akan menutupi kelalaian.
  merchantServiceFeeFlat = 0,
}: {
  item: SupplierPricedPackage;
  paymentMethod: PaymentMethod;
  promotionDiscount: number;
  referralDiscount: number;
  pointsDiscount: number;
  affiliateRate: number;
  loyaltyEligible: boolean;
  merchantServiceFeeFlat?: number;
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

  /*
   * Biaya layanan merchant — 100% milik merchant.
   *
   * DITAMBAHKAN ke harga yang dibayar user, tapi SENGAJA TIDAK masuk ke
   * `netProfitBeforeAffiliate`. Alasan: uang ini tidak pernah melewati Lacte.
   * User membayar ke merchant, merchant IMPOR fees itu sebagai pendapatannya,
   * Lacte cuma menampilkan angkanya di checkout.
   *
   * Kalau fee ini ikut dihitung sebagai revenue Lacte, `nambahProfit` naik
   * dan guard profit akan terlihat lolos — padahal Lacte tidak menerima satu rupiah
   * pun dari fee itu. Itu akan membuat dashboard berbohong dan keputusan
   * \"apakah jalur ini untung\" tidak bisa diambil dari data.
   *
   * `pointsDiscount` TIDAK ikut jadi dasar perhitungan fee. User memakai
   * points untuk harga produk; biaya layanannya tetap dihitung dari harga
   * katalog, supaya fee merchant tidak ikut berkurang tanpa disadari saat
   * promo atau points aktif.
   */
  const merchantServiceFee =
    paymentMethod.id === MERCHANT_RETAIL_PAYMENT_METHOD_ID
      ? merchantServiceFeeFlat
      : 0;

  const finalPrice =
    loyaltyEligibleSpend + customerPaymentFee + merchantServiceFee;

  const merchantPaymentCost =
    paymentMethod.merchantFeeFlat +
    percentageOf(finalPrice, paymentMethod.merchantFeePercent);

  // Earned points are treated as a loyalty liability immediately so referral
  // commission and the minimum-profit guard cannot silently consume the reward.
  //
  // `merchantServiceFee` sengaja tidak ada di sini — lihat catatan di atas.
  const netProfitBeforeAffiliate =
    finalPrice - merchantServiceFee - item.supplierCost - merchantPaymentCost -
    pointsRewardValue;
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
    merchantServiceFee,
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
  linkAffiliate = null,
  pointsDiscount = 0,
  loyaltyEligible = false,
  minimumNambahProfit = MINIMUM_NAMBAH_PROFIT,
  // Sengaja TANPA default. Default `0` membuat `undefined` mustahil terjadi,
  // sehingga guard "fee wajib diisi untuk jalur ritel" tidak pernah menyala -
  // dan kelalaian diteruskannya argumen akan lolos tanpa suara.
  merchantServiceFeeFlat,
}: {
  item: SupplierPricedPackage;
  paymentMethod: PaymentMethod;
  promotion: Promotion | null;
  referral: ReferralProgram | null;
  /**
   * Affiliate dari kode link. Memberi KOMISI saja — pembeli tidak dapat
   * diskon dan tidak perlu login. Berlaku untuk tamu.
   *
   * Kalau `referral` tidak null, kode manual menang dan `linkAffiliate`
   * diabaikan, jadi kedua-duanya tidak pernah dipakai bersamaan.
   */
  linkAffiliate?: { code: string; commissionRate: number } | null;
  pointsDiscount?: number;
  loyaltyEligible?: boolean;
  minimumNambahProfit?: number;
  /**
   * Biaya layanan merchant, dalam persen dari harga katalog.
   *
   * HANYA dipakai untuk `merchant_retail` — lihat `evaluatePrice`. Nilai ini
   * datang dari `merchants.service_fee_flat_idr`, bukan dari tabel
   * `payment_methods`, supaya tiap merchant bisa punya tarifnya sendiri dan
   * admin bisa mengubahnya tanpa menyentuh katalog global.
   *
   * PENGECUALIAN PENTING: nilai yang dipakai di checkout WAJIB ikut
   * di-snapshot ke `orders.service_fee_flat_snapshot`. Kalau admin
   * mengubah tarif setelah user menekan tombol bayar, order yang sudah
   * dibuat harus tetap memakai angka yang dilihat user — kalau tidak, nota
   * dan piutang merchant bisa berbeda.
   */
  merchantServiceFeeFlat?: number;
}): PricingResult {
  const normalizedPointsDiscount =
    Number.isInteger(pointsDiscount) && pointsDiscount > 0
      ? pointsDiscount
      : 0;

  /*
   * Fee merchant WAJIB diberikan secara eksplisit untuk jalur ritel.
   *
   * Ini dijaga dengan melempar error, bukan menerima default 0, karena
   * kelalaian "saya lupa meneruskan fee di panggilan kedua" menghasilkan
   * order dengan total yang lebih kecil dari yang dilihat user - dan
   * piutang merchant yang kehilangan sebagian biaya layanan. Keduanya angka yang
   * terlihat wajar, jadi tidak akan ditemukan saat eyeballing.
   *
   * Default `0` di signature tetap ada untuk pemanggil yang memang tidak
   * punya merchant (mis. pratinjau sebelum toko dipilih) - yang melempar
   * hanya kalau jalur ritel dipilih DAN fee tidak diisi sama sekali.
   */
  if (
    paymentMethod.id === MERCHANT_RETAIL_PAYMENT_METHOD_ID &&
    merchantServiceFeeFlat === undefined
  ) {
    throw new Error(
      "Biaya layanan merchant wajib diisi untuk jalur merchant_retail.",
    );
  }

  // Fee dibulatkan ke rupiah penuh: kasir tidak menghitung pecahan, dan
  // nominal yang tampil di layar harus sama dengan yang benar-benar
  // dibayar.
  const normalizedMerchantFeeFlat =
    Number.isFinite(merchantServiceFeeFlat) && (merchantServiceFeeFlat as number) > 0
      ? Math.round(merchantServiceFeeFlat as number)
      : 0;
  const promo = calculatePromotionDiscount(item.sellingPrice, promotion);
  const referralBenefit = calculateReferralRequestedDiscount(
    item.sellingPrice,
    referral,
    promotion,
  );
  // Rate komisi: kode manual menang kalau ada. Kalau tidak, kode link tetap
  // memberi komisi — inilah yang membuat link tetap bernilai untuk affiliate
  // even ketika pembeli tidak Benefit apa pun.
  //
  // Tidak ada safety untuk minimum order di jalur link: benefit-nya nol, jadi
  // `minimum_order` milik affiliate tidak relevan di jalur link.
  const affiliateRate =
    referral?.commissionRate ?? linkAffiliate?.commissionRate ?? 0;

  const evaluate = (referralDiscount: number) =>
    evaluatePrice({
      item,
      paymentMethod,
      promotionDiscount: promo.amount,
      referralDiscount,
      pointsDiscount: normalizedPointsDiscount,
      affiliateRate,
      loyaltyEligible,
      merchantServiceFeeFlat: normalizedMerchantFeeFlat,
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
  //
  // PENGECUALIAN JALUR MERCHANT: guard ini dilewati untuk
  // `payment_method = "merchant_retail"`.
  //
  // Bukan bug dan bukan shortcut. Pada jalur merchant, biaya layanan 100%
  // milik merchant — Lacte tidak mengambil apa pun, jadi `nambahProfit`
  // selalu 0 dan setiap order akan ditolak di sini kalau guard tidak
  // dilewati. Model bisnisnya sudah diputuskan: LacteFSI armar ransom
  // dari fee, tapi menganggap merchandise sebagai piutang. Margin di jalur
  // ini bukan "profit", tapi uang yang akan masuk nanti lewat pelunasan —
  // dan itu dicatat di `merchant_balances`, bukan di sini.
  const isMerchantRetail = paymentMethod.id === MERCHANT_RETAIL_PAYMENT_METHOD_ID;
  const profitGuardApplies = !isMerchantRetail;

  if (
    !rejectionReason &&
    profitGuardApplies &&
    baseEvaluation.nambahProfit < minimumNambahProfit
  ) {
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
    affiliateCode: referral?.code ?? linkAffiliate?.code ?? null,
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
    merchantServiceFee: finalEvaluation.merchantServiceFee,
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
