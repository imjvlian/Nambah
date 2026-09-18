import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type AffiliateRow = {
  code: string;
  display_name: string;
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
  status: string;
  available_at: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const [affiliates, commissions] = await Promise.all([
      supabaseSelect<AffiliateRow>("affiliates", {
        select: "code,display_name,commission_rate,status,created_at",
        order: "created_at.desc",
        limit: 100,
      }),
      supabaseSelect<CommissionRow>("commissions", {
        select:
          "id,affiliate_code,order_id,base_profit,rate,amount,status,available_at,created_at",
        order: "created_at.desc",
        limit: 200,
      }),
    ]);

    const totals = commissions.reduce(
      (acc, row) => {
        const amount = Number(row.amount);
        acc[row.status as keyof typeof acc] += amount;
        return acc;
      },
      { pending: 0, available: 0, withdrawn: 0, cancelled: 0 },
    );

    return Response.json({
      stats: {
        affiliates: affiliates.length,
        active: affiliates.filter((row) => row.status === "active").length,
        ...totals,
      },
      affiliates: affiliates.map((row) => ({
        code: row.code,
        displayName: row.display_name,
        commissionRate: Number(row.commission_rate),
        status: row.status,
        createdAt: row.created_at,
      })),
      commissions: commissions.map((row) => ({
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
