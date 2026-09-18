import type { PublicOrderStatus } from "@/lib/order-public";
import {
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";

type CommissionOrderRow = {
  id: string;
  affiliate_code: string | null;
  status: PublicOrderStatus;
  net_profit_before_affiliate: number | string;
  affiliate_rate: number | string;
  affiliate_commission: number | string;
};

type CommissionRow = {
  id: number;
  affiliate_code: string;
  order_id: string;
  base_profit: number | string;
  rate: number | string;
  amount: number | string;
  status: "pending" | "available" | "withdrawn" | "cancelled";
  available_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function syncOrderCommissionLifecycle(
  orderId: string,
  status?: PublicOrderStatus,
) {
  const [order] = await supabaseSelect<CommissionOrderRow>("orders", {
    select:
      "id,affiliate_code,status,net_profit_before_affiliate,affiliate_rate,affiliate_commission",
    filters: { id: "eq." + orderId },
    limit: 1,
  });

  if (!order || !order.affiliate_code) return null;

  const amount = Math.max(0, Number(order.affiliate_commission));
  const rate = Math.max(0, Number(order.affiliate_rate));
  const baseProfit = Number(order.net_profit_before_affiliate);
  if (amount <= 0 || rate <= 0) return null;

  const targetStatus = status ?? order.status;
  const now = new Date().toISOString();

  const [existing] = await supabaseSelect<CommissionRow>("commissions", {
    select:
      "id,affiliate_code,order_id,base_profit,rate,amount,status,available_at,created_at,updated_at",
    filters: { order_id: "eq." + orderId },
    limit: 1,
  });

  if (existing?.status === "withdrawn") return existing;

  if (
    targetStatus === "pending_payment"
  ) {
    return existing ?? null;
  }

  if (targetStatus === "paid" || targetStatus === "processing") {
    await supabaseUpsert(
      "commissions",
      {
        affiliate_code: order.affiliate_code,
        order_id: orderId,
        base_profit: baseProfit,
        rate,
        amount,
        status: existing?.status === "available" ? "available" : "pending",
        available_at: existing?.available_at ?? null,
        updated_at: now,
      },
      {
        onConflict: "order_id",
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
  } else if (targetStatus === "success") {
    await supabaseUpsert(
      "commissions",
      {
        affiliate_code: order.affiliate_code,
        order_id: orderId,
        base_profit: baseProfit,
        rate,
        amount,
        status: "available",
        available_at: existing?.available_at ?? now,
        updated_at: now,
      },
      {
        onConflict: "order_id",
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
  } else if (
    targetStatus === "failed" ||
    targetStatus === "refunded" ||
    targetStatus === "cancelled"
  ) {
    if (existing) {
      await supabaseUpdate(
        "commissions",
        {
          status: "cancelled",
          available_at: null,
          updated_at: now,
        },
        {
          filters: {
            order_id: "eq." + orderId,
            status: "in.(pending,available)",
          },
        },
      );
    }
  }

  const [current] = await supabaseSelect<CommissionRow>("commissions", {
    select:
      "id,affiliate_code,order_id,base_profit,rate,amount,status,available_at,created_at,updated_at",
    filters: { order_id: "eq." + orderId },
    limit: 1,
  });
  return current ?? null;
}
