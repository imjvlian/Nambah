import { authorizeAdminRequest } from "@/lib/admin-api";
import {
  POINT_EARN_SPEND_IDR,
  POINT_MAX_REDEEM_RATE,
  POINT_MIN_REDEEM,
  POINT_REDEEM_STEP,
  POINT_VALUE_IDR,
} from "@/lib/loyalty";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type LoyaltyAccountRow = {
  user_id: string;
  points_balance: number | string;
  reserved_points: number | string;
  lifetime_earned: number | string;
  lifetime_redeemed: number | string;
  updated_at: string;
};

type LedgerRow = {
  id: number;
  user_id: string;
  order_id: string | null;
  type: string;
  points_delta: number | string;
  reserved_delta: number | string;
  balance_after: number | string;
  reserved_after: number | string;
  note: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const [accounts, ledger] = await Promise.all([
      supabaseSelect<LoyaltyAccountRow>("loyalty_accounts", {
        select:
          "user_id,points_balance,reserved_points,lifetime_earned,lifetime_redeemed,updated_at",
        order: "updated_at.desc",
        limit: 5000,
      }),
      supabaseSelect<LedgerRow>("point_ledger", {
        select:
          "id,user_id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,note,created_at",
        order: "created_at.desc",
        limit: 100,
      }),
    ]);

    const normalizedAccounts = accounts.map((row) => {
      const balance = Number(row.points_balance);
      const reserved = Number(row.reserved_points);
      return {
        userId: row.user_id,
        balance,
        reserved,
        available: Math.max(0, balance - reserved),
        lifetimeEarned: Number(row.lifetime_earned),
        lifetimeRedeemed: Number(row.lifetime_redeemed),
        updatedAt: row.updated_at,
      };
    });

    return Response.json({
      stats: {
        accounts: normalizedAccounts.length,
        outstanding: normalizedAccounts.reduce(
          (sum, row) => sum + row.balance,
          0,
        ),
        reserved: normalizedAccounts.reduce(
          (sum, row) => sum + row.reserved,
          0,
        ),
        available: normalizedAccounts.reduce(
          (sum, row) => sum + row.available,
          0,
        ),
        lifetimeEarned: normalizedAccounts.reduce(
          (sum, row) => sum + row.lifetimeEarned,
          0,
        ),
        lifetimeRedeemed: normalizedAccounts.reduce(
          (sum, row) => sum + row.lifetimeRedeemed,
          0,
        ),
      },
      rules: {
        pointValueIdr: POINT_VALUE_IDR,
        earnEveryIdr: POINT_EARN_SPEND_IDR,
        minimumRedeem: POINT_MIN_REDEEM,
        redeemStep: POINT_REDEEM_STEP,
        maxRedeemRate: POINT_MAX_REDEEM_RATE,
      },
      accounts: normalizedAccounts.slice(0, 100),
      ledger: ledger.map((row) => ({
        id: row.id,
        userId: row.user_id,
        orderId: row.order_id,
        type: row.type,
        pointsDelta: Number(row.points_delta),
        reservedDelta: Number(row.reserved_delta),
        balanceAfter: Number(row.balance_after),
        reservedAfter: Number(row.reserved_after),
        note: row.note,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("Admin Nambah Points failed", error);
    return Response.json(
      { error: "Data Nambah Points tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
