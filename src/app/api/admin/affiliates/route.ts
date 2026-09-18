import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type AffiliateRow = {
  code: string;
  display_name: string;
  user_id: string | null;
  commission_rate: number | string;
  status: string;
  created_at: string;
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
};

type WithdrawalRow = {
  id: number;
  affiliate_code: string;
  amount: number | string;
  status: "pending" | "approved" | "paid" | "rejected" | "cancelled";
};

type AllocationRow = {
  withdrawal_id: number;
  commission_id: number;
  amount: number | string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const [affiliates, commissions, withdrawals, allocations] =
      await Promise.all([
        supabaseSelect<AffiliateRow>("affiliates", {
          select: "code,display_name,user_id,commission_rate,status,created_at",
          order: "created_at.desc",
          limit: 1000,
        }),
        supabaseSelect<CommissionRow>("commissions", {
          select:
            "id,affiliate_code,order_id,base_profit,rate,amount,status,available_at,created_at",
          order: "created_at.desc",
          limit: 5000,
        }),
        supabaseSelect<WithdrawalRow>("affiliate_withdrawals", {
          select: "id,affiliate_code,amount,status",
          order: "requested_at.desc",
          limit: 5000,
        }),
        supabaseSelect<AllocationRow>("affiliate_withdrawal_allocations", {
          select: "withdrawal_id,commission_id,amount",
          limit: 10000,
        }),
      ]);

    const withdrawalById = new Map(
      withdrawals.map((row) => [row.id, row]),
    );
    const allocatedByCommission = new Map<number, number>();
    let reserved = 0;

    for (const allocation of allocations) {
      const withdrawal = withdrawalById.get(allocation.withdrawal_id);
      if (!withdrawal) continue;
      if (
        withdrawal.status !== "pending" &&
        withdrawal.status !== "approved" &&
        withdrawal.status !== "paid"
      ) {
        continue;
      }

      const amount = Number(allocation.amount);
      allocatedByCommission.set(
        allocation.commission_id,
        (allocatedByCommission.get(allocation.commission_id) ?? 0) + amount,
      );

      if (
        withdrawal.status === "pending" ||
        withdrawal.status === "approved"
      ) {
        reserved += amount;
      }
    }

    const totals = commissions.reduce(
      (acc, row) => {
        const amount = Number(row.amount);
        if (row.status === "pending") acc.pending += amount;
        if (row.status === "cancelled") acc.cancelled += amount;
        if (row.status === "available") {
          acc.available += Math.max(
            0,
            amount - (allocatedByCommission.get(row.id) ?? 0),
          );
        }
        return acc;
      },
      { pending: 0, available: 0, cancelled: 0 },
    );

    const withdrawn = withdrawals
      .filter((row) => row.status === "paid")
      .reduce((sum, row) => sum + Number(row.amount), 0);

    return Response.json({
      stats: {
        affiliates: affiliates.length,
        active: affiliates.filter((row) => row.status === "active").length,
        pending: totals.pending,
        available: totals.available,
        reserved,
        withdrawn,
        cancelled: totals.cancelled,
      },
      affiliates: affiliates.map((row) => ({
        code: row.code,
        displayName: row.display_name,
        userId: row.user_id,
        commissionRate: Number(row.commission_rate),
        status: row.status,
        createdAt: row.created_at,
      })),
      commissions: commissions.slice(0, 200).map((row) => ({
        id: row.id,
        affiliateCode: row.affiliate_code,
        orderId: row.order_id,
        baseProfit: Number(row.base_profit),
        rate: Number(row.rate),
        amount: Number(row.amount),
        status: row.status,
        availableAt: row.available_at,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("Admin affiliate ledger failed", error);
    return Response.json(
      { error: "Affiliate ledger tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
