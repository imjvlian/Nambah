import { POINT_VALUE_IDR } from "@/lib/loyalty";
import {
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase/server";

type FinancialOrderRow = {
  id: string;
  status: string;
  affiliate_code: string | null;
  selling_price: number | string;
  supplier_cost: number | string;
  customer_payment_fee: number | string;
  merchant_payment_cost: number | string;
  promotion_discount: number | string;
  referral_discount: number | string;
  points_redeemed: number | string;
  points_discount: number | string;
  points_earned: number | string;
  final_price: number | string;
  net_profit_before_affiliate: number | string;
  affiliate_rate: number | string;
  affiliate_commission: number | string;
  nambah_profit: number | string;
  created_at: string;
  updated_at: string;
};

type PaymentRow = {
  provider: string;
  status: string;
  amount: number | string;
  raw_status: string | null;
  paid_at: string | null;
  updated_at: string;
};

type SupplierRow = {
  supplier_id: string;
  status: string;
  cost: number | string;
  request_ref: string;
  supplier_sku: string | null;
  updated_at: string;
};

type CommissionRow = {
  status: string;
  amount: number | string;
  base_profit: number | string;
  rate: number | string;
  updated_at: string;
};

export type FinancialIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  expected?: number | string;
  actual?: number | string;
};

export type FinancialReconciliation = {
  orderId: string;
  orderStatus: string;
  result: "ok" | "warning" | "error";
  issues: FinancialIssue[];
  expected: Record<string, number | string | null>;
  actual: Record<string, number | string | null>;
  checkedAt: string;
};

function n(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPaidOrderStatus(status: string) {
  return ["paid", "processing", "success", "refunded"].includes(status);
}

export async function reconcileOrderFinancial(
  orderId: string,
): Promise<FinancialReconciliation> {
  const [orders, payments, suppliers, commissions] = await Promise.all([
    supabaseSelect<FinancialOrderRow>("orders", {
      select:
        "id,status,affiliate_code,selling_price,supplier_cost,customer_payment_fee,merchant_payment_cost,promotion_discount,referral_discount,points_redeemed,points_discount,points_earned,final_price,net_profit_before_affiliate,affiliate_rate,affiliate_commission,nambah_profit,created_at,updated_at",
      filters: { id: "eq." + orderId },
      limit: 1,
    }),
    supabaseSelect<PaymentRow>("payments", {
      select: "provider,status,amount,raw_status,paid_at,updated_at",
      filters: { order_id: "eq." + orderId },
      order: "updated_at.desc",
      limit: 10,
    }),
    supabaseSelect<SupplierRow>("supplier_transactions", {
      select:
        "supplier_id,status,cost,request_ref,supplier_sku,updated_at",
      filters: { order_id: "eq." + orderId },
      order: "updated_at.desc",
      limit: 10,
    }),
    supabaseSelect<CommissionRow>("commissions", {
      select: "status,amount,base_profit,rate,updated_at",
      filters: { order_id: "eq." + orderId },
      limit: 5,
    }).catch(() => []),
  ]);

  const order = orders[0];
  if (!order) throw new Error("Order " + orderId + " tidak ditemukan.");

  const issues: FinancialIssue[] = [];
  const sellingPrice = n(order.selling_price);
  const supplierCost = n(order.supplier_cost);
  const customerPaymentFee = n(order.customer_payment_fee);
  const merchantPaymentCost = n(order.merchant_payment_cost);
  const promotionDiscount = n(order.promotion_discount);
  const referralDiscount = n(order.referral_discount);
  const pointsRedeemed = n(order.points_redeemed);
  const pointsDiscount = n(order.points_discount);
  const pointsEarned = n(order.points_earned);
  const finalPrice = n(order.final_price);
  const affiliateRate = n(order.affiliate_rate);
  const affiliateCommission = n(order.affiliate_commission);

  const expectedPointsDiscount = pointsRedeemed * POINT_VALUE_IDR;
  const expectedFinalPrice =
    sellingPrice -
    promotionDiscount -
    referralDiscount -
    pointsDiscount +
    customerPaymentFee;
  const expectedPointsLiability = pointsEarned * POINT_VALUE_IDR;
  const expectedNetProfit =
    finalPrice -
    supplierCost -
    merchantPaymentCost -
    expectedPointsLiability;
  const expectedAffiliateCommission =
    affiliateRate > 0
      ? Math.max(0, Math.floor(expectedNetProfit * affiliateRate))
      : 0;
  const expectedNambahProfit =
    expectedNetProfit - expectedAffiliateCommission;

  if (pointsDiscount !== expectedPointsDiscount) {
    issues.push({
      code: "points_discount_mismatch",
      severity: "error",
      message: "Nilai diskon Points tidak sama dengan points yang diredeem.",
      expected: expectedPointsDiscount,
      actual: pointsDiscount,
    });
  }

  if (finalPrice !== expectedFinalPrice) {
    issues.push({
      code: "final_price_mismatch",
      severity: "error",
      message: "Final price tidak cocok dengan frozen pricing breakdown.",
      expected: expectedFinalPrice,
      actual: finalPrice,
    });
  }

  if (n(order.net_profit_before_affiliate) !== expectedNetProfit) {
    issues.push({
      code: "net_profit_mismatch",
      severity: "error",
      message: "Net profit before affiliate tidak cocok.",
      expected: expectedNetProfit,
      actual: n(order.net_profit_before_affiliate),
    });
  }

  if (affiliateCommission !== expectedAffiliateCommission) {
    issues.push({
      code: "affiliate_commission_mismatch",
      severity: "error",
      message: "Affiliate commission frozen tidak cocok dengan rate/net profit.",
      expected: expectedAffiliateCommission,
      actual: affiliateCommission,
    });
  }

  if (n(order.nambah_profit) !== expectedNambahProfit) {
    issues.push({
      code: "nambah_profit_mismatch",
      severity: "error",
      message: "Nambah profit frozen tidak cocok.",
      expected: expectedNambahProfit,
      actual: n(order.nambah_profit),
    });
  }

  const payment = payments.find((row) => row.provider === "midtrans") ?? payments[0];
  if (!payment) {
    issues.push({
      code: "payment_missing",
      severity: order.status === "pending_payment" ? "warning" : "error",
      message: "Payment row tidak ditemukan.",
    });
  } else {
    if (n(payment.amount) !== finalPrice) {
      issues.push({
        code: "payment_amount_mismatch",
        severity: "error",
        message: "Nominal payment tidak cocok dengan final price order.",
        expected: finalPrice,
        actual: n(payment.amount),
      });
    }

    if (
      isPaidOrderStatus(order.status) &&
      !["settlement", "capture", "refund"].includes(payment.status)
    ) {
      issues.push({
        code: "payment_status_inconsistent",
        severity: "warning",
        message: "Status order sudah paid/terminal tetapi payment belum terminal-paid.",
        expected: order.status,
        actual: payment.status,
      });
    }
  }

  const supplier = suppliers[0];
  if (order.status === "success" && !supplier) {
    issues.push({
      code: "supplier_transaction_missing",
      severity: "error",
      message: "Order success tanpa supplier transaction.",
    });
  }

  if (supplier) {
    const supplierActualCost = n(supplier.cost);
    if (supplierActualCost > supplierCost) {
      issues.push({
        code: "supplier_cost_over_frozen",
        severity: "error",
        message: "Supplier actual cost melebihi frozen supplier cost order.",
        expected: supplierCost,
        actual: supplierActualCost,
      });
    }

    if (order.status === "success" && supplier.status !== "success") {
      issues.push({
        code: "supplier_status_inconsistent",
        severity: "error",
        message: "Order success tetapi supplier transaction belum success.",
        expected: "success",
        actual: supplier.status,
      });
    }
  }

  const commission = commissions[0];
  if (expectedAffiliateCommission > 0 && !commission) {
    issues.push({
      code: "commission_missing",
      severity: "error",
      message: "Order affiliate memiliki commission tetapi ledger belum ada.",
      expected: expectedAffiliateCommission,
      actual: 0,
    });
  }

  if (commission) {
    if (n(commission.amount) !== expectedAffiliateCommission) {
      issues.push({
        code: "commission_ledger_amount_mismatch",
        severity: "error",
        message: "Commission ledger tidak sama dengan frozen order commission.",
        expected: expectedAffiliateCommission,
        actual: n(commission.amount),
      });
    }

    const expectedStatus =
      order.status === "success"
        ? "available"
        : ["failed", "cancelled", "refunded"].includes(order.status)
          ? "cancelled"
          : ["paid", "processing"].includes(order.status)
            ? "pending"
            : null;

    if (
      expectedStatus &&
      commission.status !== expectedStatus &&
      commission.status !== "withdrawn"
    ) {
      issues.push({
        code: "commission_status_inconsistent",
        severity: "warning",
        message: "Commission lifecycle belum mengikuti status order.",
        expected: expectedStatus,
        actual: commission.status,
      });
    }
  }

  const result: FinancialReconciliation["result"] = issues.some(
    (issue) => issue.severity === "error",
  )
    ? "error"
    : issues.length > 0
      ? "warning"
      : "ok";

  const checkedAt = new Date().toISOString();
  const expected = {
    pointsDiscount: expectedPointsDiscount,
    finalPrice: expectedFinalPrice,
    pointsLiability: expectedPointsLiability,
    netProfitBeforeAffiliate: expectedNetProfit,
    affiliateCommission: expectedAffiliateCommission,
    nambahProfit: expectedNambahProfit,
  };
  const actual = {
    orderStatus: order.status,
    pointsDiscount,
    finalPrice,
    netProfitBeforeAffiliate: n(order.net_profit_before_affiliate),
    affiliateCommission,
    nambahProfit: n(order.nambah_profit),
    paymentAmount: payment ? n(payment.amount) : null,
    paymentStatus: payment?.status ?? null,
    supplierCost: supplier ? n(supplier.cost) : null,
    supplierStatus: supplier?.status ?? null,
    commissionAmount: commission ? n(commission.amount) : null,
    commissionStatus: commission?.status ?? null,
  };

  await supabaseUpsert(
    "financial_reconciliations",
    {
      order_id: order.id,
      result,
      issues,
      expected,
      actual,
      checked_at: checkedAt,
      updated_at: checkedAt,
    },
    {
      onConflict: "order_id",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  return {
    orderId: order.id,
    orderStatus: order.status,
    result,
    issues,
    expected,
    actual,
    checkedAt,
  };
}

export async function runFinancialReconciliation(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const orders = await supabaseSelect<{ id: string }>("orders", {
    select: "id",
    order: "created_at.desc",
    limit: safeLimit,
  });

  const rows: FinancialReconciliation[] = [];
  for (const order of orders) {
    rows.push(await reconcileOrderFinancial(order.id));
  }

  return {
    checked: rows.length,
    ok: rows.filter((row) => row.result === "ok").length,
    warning: rows.filter((row) => row.result === "warning").length,
    errors: rows.filter((row) => row.result === "error").length,
    rows,
  };
}
