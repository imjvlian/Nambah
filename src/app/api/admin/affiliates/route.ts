import { randomInt } from "node:crypto";
import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { supabaseInsert, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;
const BENEFIT_TYPES = new Set(["flat", "percentage"]);

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "")
    .slice(0, 40);
}

function codeBaseFromName(displayName: string) {
  const base = normalizeCode(displayName.replace(/[^A-Za-z0-9]+/g, ""));
  return base.length >= 3 ? base.slice(0, 12) : "";
}

function randomSuffix() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

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

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (displayName.length < 3 || displayName.length > 80) {
      return Response.json(
        { error: "Display name wajib 3–80 karakter." },
        { status: 400 },
      );
    }

    const requestedCode = normalizeCode(
      typeof body.code === "string" ? body.code.trim() : "",
    );
    let code = requestedCode;
    if (!code) {
      const base = codeBaseFromName(displayName);
      if (!base) {
        return Response.json(
          { error: "Kode otomatis gagal dibuat dari display name ini. Isi kode manual." },
          { status: 400 },
        );
      }
      code = base;
    }
    if (!CODE_PATTERN.test(code)) {
      return Response.json(
        { error: "Kode affiliate hanya boleh huruf besar, angka, - atau _ (3–40 karakter)." },
        { status: 400 },
      );
    }

    const commissionRate =
      body.commissionRate === undefined || body.commissionRate === null
        ? 0.2
        : Number(body.commissionRate);
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1) {
      return Response.json(
        { error: "Commission rate harus antara 0 dan 1 (contoh: 0.2 untuk 20%)." },
        { status: 400 },
      );
    }

    const userBenefitType =
      typeof body.userBenefitType === "string" ? body.userBenefitType.trim() : "flat";
    if (!BENEFIT_TYPES.has(userBenefitType)) {
      return Response.json(
        { error: "User benefit type harus flat atau percentage." },
        { status: 400 },
      );
    }

    const userBenefitValue =
      body.userBenefitValue === undefined || body.userBenefitValue === null
        ? 0
        : Number(body.userBenefitValue);
    if (!Number.isFinite(userBenefitValue) || userBenefitValue < 0) {
      return Response.json(
        { error: "User benefit value tidak boleh negatif." },
        { status: 400 },
      );
    }

    const minimumOrder =
      body.minimumOrder === undefined || body.minimumOrder === null
        ? 0
        : Math.round(Number(body.minimumOrder));
    if (!Number.isFinite(minimumOrder) || minimumOrder < 0) {
      return Response.json(
        { error: "Minimum order tidak boleh negatif." },
        { status: 400 },
      );
    }

    const maxUserBenefit =
      body.maxUserBenefit === undefined ||
      body.maxUserBenefit === null ||
      body.maxUserBenefit === ""
        ? null
        : Math.round(Number(body.maxUserBenefit));
    if (
      maxUserBenefit !== null &&
      (!Number.isFinite(maxUserBenefit) || maxUserBenefit < 0)
    ) {
      return Response.json(
        { error: "Max user benefit tidak boleh negatif." },
        { status: 400 },
      );
    }

    const stackableWithPromotions = body.stackableWithPromotions !== false;

    // Assign hanya ke user yang benar-benar terdaftar (ada profilnya).
    const rawUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    let userId: string | null = null;
    if (rawUserId) {
      if (!validUuid(rawUserId)) {
        return Response.json({ error: "User ID tidak valid." }, { status: 400 });
      }
      const [profile] = await supabaseSelect<{ user_id: string }>(
        "customer_profiles",
        {
          select: "user_id",
          filters: { user_id: `eq.${rawUserId}` },
          limit: 1,
        },
      );
      if (!profile) {
        return Response.json(
          { error: "User belum terdaftar sebagai customer Nambah." },
          { status: 400 },
        );
      }
      userId = rawUserId;
    }

    // Cegah duplikat kode; bila kode auto-generate, coba beberapa suffix acak.
    let finalCode = code;
    for (let attempt = 0; ; attempt += 1) {
      const [existing] = await supabaseSelect<{ code: string }>("affiliates", {
        select: "code",
        filters: { code: `eq.${finalCode}` },
        limit: 1,
      });
      if (!existing) break;
      if (requestedCode) {
        return Response.json(
          { error: `Kode ${finalCode} sudah dipakai affiliate lain.` },
          { status: 409 },
        );
      }
      if (attempt >= 4) {
        return Response.json(
          { error: "Kode otomatis bentrok terus. Isi kode manual." },
          { status: 409 },
        );
      }
      finalCode = `${codeBaseFromName(displayName).slice(0, 8)}-${randomSuffix()}`;
    }

    const now = new Date().toISOString();
    await supabaseInsert("affiliates", {
      code: finalCode,
      display_name: displayName,
      commission_rate: commissionRate,
      user_benefit_type: userBenefitType,
      user_benefit_value: userBenefitValue,
      minimum_order: minimumOrder,
      max_user_benefit: maxUserBenefit,
      stackable_with_promotions: stackableWithPromotions,
      status: "active",
      ...(userId ? { user_id: userId } : {}),
      created_at: now,
      updated_at: now,
    });

    await auditAdminAction(request, {
      action: "affiliate.create",
      targetType: "affiliate",
      targetId: finalCode,
      metadata: { displayName, commissionRate, userId },
    });

    return Response.json({
      affiliate: {
        code: finalCode,
        displayName,
        commissionRate,
        userId,
      },
    });
  } catch (error) {
    console.error("Affiliate create failed", error);
    return Response.json(
      { error: "Affiliate gagal dibuat." },
      { status: 502 },
    );
  }
}
