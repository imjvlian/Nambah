import type { PublicOrderStatus } from "@/lib/order-public";
import {
  supabaseRpc,
  supabaseSelect,
} from "@/lib/supabase/server";

export const POINT_VALUE_IDR = 10;
export const POINT_EARN_SPEND_IDR = 2_000;
export const POINT_MIN_REDEEM = 100;
export const POINT_REDEEM_STEP = 100;
export const POINT_MAX_REDEEM_RATE = 0.2;

type LoyaltyAccountRow = {
  user_id: string;
  points_balance: number | string;
  reserved_points: number | string;
  lifetime_earned: number | string;
  lifetime_redeemed: number | string;
  created_at: string;
  updated_at: string;
};

type PointLedgerRow = {
  id: number;
  order_id: string | null;
  type:
    | "reserve"
    | "redeem"
    | "release"
    | "earn"
    | "refund"
    | "reversal"
    | "expire"
    | "admin_adjustment";
  points_delta: number | string;
  reserved_delta: number | string;
  balance_after: number | string;
  reserved_after: number | string;
  note: string | null;
  expires_at: string | null;
  created_at: string;
};

type RpcBalance = {
  pointsBalance?: number;
  reservedPoints?: number;
  availablePoints?: number;
};

export type PointsSummary = {
  balance: number;
  reserved: number;
  available: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  rules: {
    pointValueIdr: number;
    earnEveryIdr: number;
    minimumRedeem: number;
    redeemStep: number;
    maxRedeemRate: number;
  };
};

export function pointsToIdr(points: number) {
  return Math.max(0, Math.floor(points)) * POINT_VALUE_IDR;
}

export function calculateEarnedPoints(eligibleSpend: number) {
  if (!Number.isFinite(eligibleSpend) || eligibleSpend <= 0) return 0;
  return Math.floor(eligibleSpend / POINT_EARN_SPEND_IDR);
}

export function maxRedeemablePointsForSubtotal(subtotal: number) {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const maxDiscount = Math.floor(subtotal * POINT_MAX_REDEEM_RATE);
  const rawPoints = Math.floor(maxDiscount / POINT_VALUE_IDR);
  return Math.floor(rawPoints / POINT_REDEEM_STEP) * POINT_REDEEM_STEP;
}

export function validateRequestedPoints(points: unknown) {
  if (points === undefined || points === null || points === "") {
    return { ok: true as const, points: 0 };
  }

  const parsed = Number(points);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return {
      ok: false as const,
      error: "Nambah Points yang digunakan tidak valid.",
    };
  }

  if (parsed === 0) return { ok: true as const, points: 0 };

  if (parsed < POINT_MIN_REDEEM) {
    return {
      ok: false as const,
      error: `Minimum penggunaan Nambah Points adalah ${POINT_MIN_REDEEM} points.`,
    };
  }

  if (parsed % POINT_REDEEM_STEP !== 0) {
    return {
      ok: false as const,
      error: `Nambah Points harus digunakan dalam kelipatan ${POINT_REDEEM_STEP} points.`,
    };
  }

  return { ok: true as const, points: parsed };
}

export async function getPointsSummary(userId: string): Promise<PointsSummary> {
  const [account] = await supabaseSelect<LoyaltyAccountRow>("loyalty_accounts", {
    select:
      "user_id,points_balance,reserved_points,lifetime_earned,lifetime_redeemed,created_at,updated_at",
    filters: { user_id: `eq.${userId}` },
    limit: 1,
  });

  const balance = Number(account?.points_balance ?? 0);
  const reserved = Number(account?.reserved_points ?? 0);

  return {
    balance,
    reserved,
    available: Math.max(0, balance - reserved),
    lifetimeEarned: Number(account?.lifetime_earned ?? 0),
    lifetimeRedeemed: Number(account?.lifetime_redeemed ?? 0),
    rules: {
      pointValueIdr: POINT_VALUE_IDR,
      earnEveryIdr: POINT_EARN_SPEND_IDR,
      minimumRedeem: POINT_MIN_REDEEM,
      redeemStep: POINT_REDEEM_STEP,
      maxRedeemRate: POINT_MAX_REDEEM_RATE,
    },
  };
}

export async function getPointsLedger(userId: string, limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await supabaseSelect<PointLedgerRow>("point_ledger", {
    select:
      "id,order_id,type,points_delta,reserved_delta,balance_after,reserved_after,note,expires_at,created_at",
    filters: { user_id: `eq.${userId}` },
    order: "created_at.desc",
    limit: safeLimit,
  });

  return rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    type: row.type,
    pointsDelta: Number(row.points_delta),
    reservedDelta: Number(row.reserved_delta),
    balanceAfter: Number(row.balance_after),
    reservedAfter: Number(row.reserved_after),
    note: row.note,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function reserveOrderPoints(orderId: string, userId: string) {
  return supabaseRpc<RpcBalance>("nambah_points_reserve", {
    p_user_id: userId,
    p_order_id: orderId,
  });
}

async function commitOrderPointsRedemption(orderId: string) {
  return supabaseRpc<RpcBalance>("nambah_points_commit_redemption", {
    p_order_id: orderId,
  });
}

export async function restoreOrderPointsRedemption(orderId: string) {
  return supabaseRpc<RpcBalance>("nambah_points_restore_redemption", {
    p_order_id: orderId,
  });
}

async function earnOrderPoints(orderId: string) {
  return supabaseRpc<RpcBalance>("nambah_points_earn", {
    p_order_id: orderId,
  });
}

async function reverseOrderEarnedPoints(orderId: string) {
  return supabaseRpc<RpcBalance>("nambah_points_reverse_earn", {
    p_order_id: orderId,
  });
}

export async function syncOrderPointsLifecycle(
  orderId: string,
  status: PublicOrderStatus,
) {
  if (status === "paid" || status === "processing") {
    await commitOrderPointsRedemption(orderId);
    return;
  }

  if (status === "success") {
    await commitOrderPointsRedemption(orderId);
    await earnOrderPoints(orderId);
    return;
  }

  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "refunded"
  ) {
    await restoreOrderPointsRedemption(orderId);
    await reverseOrderEarnedPoints(orderId);
  }
}
