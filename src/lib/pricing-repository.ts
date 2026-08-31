import {
  games,
  paymentMethods,
  type PaymentMethod,
} from "@/lib/catalog";
import { isFlowTestMode } from "@/lib/flow-test";
import {
  findPromotion,
  type Promotion,
} from "@/lib/pricing";
import {
  findReferral,
  type ReferralProgram,
} from "@/lib/referrals";
import {
  attachSupplierCost,
  type SupplierPricedPackage,
} from "@/lib/supplier-pricing";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";

type PricingRequest = {
  gameId?: string;
  packageId?: string;
  paymentId?: string;
  promoCode?: string;
  referralCode?: string;
};

type PricingContext = {
  game: { id: string; name: string };
  selectedPackage: SupplierPricedPackage;
  paymentMethod: PaymentMethod;
  promotion: Promotion | null;
  referral: ReferralProgram | null;
  minimumNambahProfit: number;
  source: "static" | "supabase";
};

export type PricingContextResult =
  | { ok: true; context: PricingContext }
  | { ok: false; status: number; error: string };

type GameRow = {
  id: string;
  name: string;
};

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  note: string | null;
  selling_price: number | string;
  reference_price: number | string;
};

type SupplierProductRow = {
  supplier_cost: number | string;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  detail: string;
  customer_fee_flat: number | string;
  customer_fee_percent: number | string;
  merchant_fee_flat: number | string;
  merchant_fee_percent: number | string;
};

type PricingRuleRow = {
  minimum_nambah_profit: number | string;
};

type PromotionRow = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number | string;
  minimum_order: number | string;
  max_discount: number | string | null;
  stackable_with_referral: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type PromotionProductRow = {
  product_id: string;
};

type AffiliateRow = {
  code: string;
  display_name: string;
  commission_rate: number | string;
  user_benefit_type: "flat" | "percentage";
  user_benefit_value: number | string;
  minimum_order: number | string;
  max_user_benefit: number | string | null;
  stackable_with_promotions: boolean;
  status: "active" | "inactive" | "suspended";
};

function normalizeCode(value?: string) {
  return value?.trim().toUpperCase() ?? "";
}

function getStaticPricingContext(request: PricingRequest): PricingContextResult {
  const game = games.find((item) => item.id === request.gameId);
  const selectedPackage = game?.packages.find((item) => item.id === request.packageId);
  const paymentMethod = paymentMethods.find((item) => item.id === request.paymentId);

  if (!game || !selectedPackage || !paymentMethod) {
    return { ok: false, status: 400, error: "Produk atau metode pembayaran tidak valid." };
  }

  const supplierPricedPackage = attachSupplierCost(selectedPackage);
  if (!supplierPricedPackage) {
    return { ok: false, status: 503, error: "Harga supplier untuk produk ini belum tersedia." };
  }

  const promoCode = normalizeCode(request.promoCode);
  const promotion = promoCode ? findPromotion(promoCode) : null;
  if (promoCode && !promotion) {
    return { ok: false, status: 400, error: "Kode promo tidak ditemukan." };
  }

  const referralCode = normalizeCode(request.referralCode);
  const referral = referralCode ? findReferral(referralCode) : null;
  if (referralCode && !referral) {
    return { ok: false, status: 400, error: "Kode referral tidak ditemukan." };
  }

  return {
    ok: true,
    context: {
      game: { id: game.id, name: game.name },
      selectedPackage: supplierPricedPackage,
      paymentMethod,
      promotion,
      referral,
      minimumNambahProfit: 500,
      source: "static",
    },
  };
}

function isPromotionCurrentlyActive(promotion: PromotionRow) {
  const now = Date.now();
  if (promotion.starts_at && new Date(promotion.starts_at).getTime() > now) return false;
  if (promotion.ends_at && new Date(promotion.ends_at).getTime() <= now) return false;
  return true;
}

async function getSupabasePricingContext(request: PricingRequest): Promise<PricingContextResult> {
  const gameId = request.gameId?.trim() ?? "";
  const packageId = request.packageId?.trim() ?? "";
  const paymentId = request.paymentId?.trim() ?? "";
  const promoCode = normalizeCode(request.promoCode);
  const referralCode = normalizeCode(request.referralCode);

  if (!gameId || !packageId || !paymentId) {
    return { ok: false, status: 400, error: "Produk atau metode pembayaran tidak valid." };
  }

  try {
    const [
      gameRows,
      productRows,
      supplierRows,
      paymentRows,
      pricingRuleRows,
      promotionRows,
      promotionProductRows,
      affiliateRows,
    ] = await Promise.all([
      supabaseSelect<GameRow>("games", {
        select: "id,name",
        filters: { id: `eq.${gameId}`, active: "eq.true" },
        limit: 1,
      }),
      supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label,note,selling_price,reference_price",
        filters: { id: `eq.${packageId}`, game_id: `eq.${gameId}`, active: "eq.true" },
        limit: 1,
      }),
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "supplier_cost",
        filters: {
          supplier_id: "eq.digiflazz",
          product_id: `eq.${packageId}`,
          active: "eq.true",
        },
        limit: 1,
      }),
      supabaseSelect<PaymentMethodRow>("payment_methods", {
        select:
          "id,name,detail,customer_fee_flat,customer_fee_percent,merchant_fee_flat,merchant_fee_percent",
        filters: { id: `eq.${paymentId}`, active: "eq.true" },
        limit: 1,
      }),
      supabaseSelect<PricingRuleRow>("pricing_rules", {
        select: "minimum_nambah_profit",
        filters: { id: "eq.default" },
        limit: 1,
      }),
      promoCode
        ? supabaseSelect<PromotionRow>("promotions", {
            select:
              "code,name,type,value,minimum_order,max_discount,stackable_with_referral,starts_at,ends_at",
            filters: { code: `eq.${promoCode}`, active: "eq.true" },
            limit: 1,
          })
        : Promise.resolve([] as PromotionRow[]),
      promoCode
        ? supabaseSelect<PromotionProductRow>("promotion_products", {
            select: "product_id",
            filters: { promotion_code: `eq.${promoCode}` },
          })
        : Promise.resolve([] as PromotionProductRow[]),
      referralCode
        ? supabaseSelect<AffiliateRow>("affiliates", {
            select:
              "code,display_name,commission_rate,user_benefit_type,user_benefit_value,minimum_order,max_user_benefit,stackable_with_promotions,status",
            filters: { code: `eq.${referralCode}`, status: "eq.active" },
            limit: 1,
          })
        : Promise.resolve([] as AffiliateRow[]),
    ]);

    const game = gameRows[0];
    const product = productRows[0];
    const supplierProduct = supplierRows[0];
    const payment = paymentRows[0];
    const pricingRule = pricingRuleRows[0];

    if (!game || !product || !payment) {
      return { ok: false, status: 400, error: "Produk atau metode pembayaran tidak valid." };
    }

    const flowTestSupplierPackage =
      !supplierProduct && isFlowTestMode()
        ? attachSupplierCost({
            id: product.id,
            label: product.label,
            ...(product.note ? { note: product.note } : {}),
            sellingPrice: Number(product.selling_price),
            referencePrice: Number(product.reference_price),
          })
        : null;

    if (!supplierProduct && !flowTestSupplierPackage) {
      return { ok: false, status: 503, error: "Harga supplier untuk produk ini belum tersedia." };
    }

    if (!pricingRule) {
      return { ok: false, status: 503, error: "Aturan pricing belum dikonfigurasi." };
    }

    const promotionRow = promotionRows[0] ?? null;
    if (promoCode && (!promotionRow || !isPromotionCurrentlyActive(promotionRow))) {
      return { ok: false, status: 400, error: "Kode promo tidak ditemukan atau sudah tidak aktif." };
    }

    if (
      promoCode &&
      promotionProductRows.length > 0 &&
      !promotionProductRows.some((item) => item.product_id === packageId)
    ) {
      return { ok: false, status: 400, error: "Kode promo tidak berlaku untuk produk ini." };
    }

    const affiliateRow = affiliateRows[0] ?? null;
    if (referralCode && !affiliateRow) {
      return { ok: false, status: 400, error: "Kode referral tidak ditemukan." };
    }

    const promotion: Promotion | null = promotionRow
      ? {
          code: promotionRow.code,
          name: promotionRow.name,
          type: promotionRow.type,
          value: Number(promotionRow.value),
          minimumOrder: Number(promotionRow.minimum_order),
          ...(promotionRow.max_discount === null
            ? {}
            : { maxDiscount: Number(promotionRow.max_discount) }),
          stackableWithReferral: promotionRow.stackable_with_referral,
        }
      : null;

    const referral: ReferralProgram | null = affiliateRow
      ? {
          code: affiliateRow.code,
          name: affiliateRow.display_name,
          commissionRate: Number(affiliateRow.commission_rate),
          userBenefitType: affiliateRow.user_benefit_type,
          userBenefitValue: Number(affiliateRow.user_benefit_value),
          minimumOrder: Number(affiliateRow.minimum_order),
          ...(affiliateRow.max_user_benefit === null
            ? {}
            : { maxUserBenefit: Number(affiliateRow.max_user_benefit) }),
          stackableWithPromotions: affiliateRow.stackable_with_promotions,
          status: "active",
        }
      : null;

    return {
      ok: true,
      context: {
        game: { id: game.id, name: game.name },
        selectedPackage: {
          id: product.id,
          label: product.label,
          ...(product.note ? { note: product.note } : {}),
          sellingPrice: Number(product.selling_price),
          referencePrice: Number(product.reference_price),
          supplierCost: supplierProduct
            ? Number(supplierProduct.supplier_cost)
            : flowTestSupplierPackage!.supplierCost,
        },
        paymentMethod: {
          id: payment.id,
          name: payment.name,
          detail: payment.detail,
          customerFeeFlat: Number(payment.customer_fee_flat),
          customerFeePercent: Number(payment.customer_fee_percent),
          merchantFeeFlat: Number(payment.merchant_fee_flat),
          merchantFeePercent: Number(payment.merchant_fee_percent),
        },
        promotion,
        referral,
        minimumNambahProfit: Number(pricingRule.minimum_nambah_profit),
        source: "supabase",
      },
    };
  } catch (error) {
    console.error("Supabase pricing lookup failed", error);
    return {
      ok: false,
      status: 503,
      error: "Database pricing sedang tidak tersedia. Coba lagi.",
    };
  }
}

export async function getPricingContext(request: PricingRequest): Promise<PricingContextResult> {
  if (!isSupabaseConfigured()) return getStaticPricingContext(request);
  return getSupabasePricingContext(request);
}
