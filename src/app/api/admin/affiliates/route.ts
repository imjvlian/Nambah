import { randomInt } from "node:crypto";
import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  supabaseAuthAdminGetUser,
  supabaseDelete,
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";

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
  user_benefit_type: string;
  user_benefit_value: number | string;
  minimum_order: number | string;
  max_user_benefit: number | string | null;
  stackable_with_promotions: boolean;
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
          select:
            "code,display_name,user_id,commission_rate,user_benefit_type,user_benefit_value,minimum_order,max_user_benefit,stackable_with_promotions,status,created_at",
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
        userBenefitType: row.user_benefit_type,
        userBenefitValue: Number(row.user_benefit_value),
        minimumOrder: Number(row.minimum_order),
        maxUserBenefit:
          row.max_user_benefit === null ? null : Number(row.max_user_benefit),
        stackableWithPromotions: row.stackable_with_promotions,
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
  // Admin ke atas (admin/superadmin/legacy) boleh mengelola affiliate.
  // Payout withdrawal tetap superadmin-only di endpoint withdrawals.
  const auth = authorizeAdminRequest(request);
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

    // "Terdaftar" diverifikasi ke Supabase Auth (sumber kebenaran akun),
    // BUKAN ke customer_profiles — tabel itu baru terisi setelah user menyimpan
    // profilnya, sehingga akun baru yang belum mengisi profil pernah tertolak
    // dengan pesan "belum terdaftar" yang menyesatkan.
    const rawUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    let userId: string | null = null;
    if (rawUserId) {
      if (!validUuid(rawUserId)) {
        return Response.json({ error: "User ID tidak valid." }, { status: 400 });
      }
      const authUser = await supabaseAuthAdminGetUser(rawUserId);
      if (!authUser) {
        return Response.json(
          { error: "User dengan ID ini tidak ditemukan di sistem auth." },
          { status: 400 },
        );
      }
      // Pastikan baris profil minimal ada supaya konsisten dengan tab Users
      // dan fitur lain yang membaca customer_profiles.
      await supabaseUpsert(
        "customer_profiles",
        {
          user_id: rawUserId,
          preferred_receipt_channel: "email",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
          prefer: "resolution=merge-duplicates,return=representation",
        },
      );
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

const AFFILIATE_STATUSES = new Set(["active", "inactive", "suspended"]);

export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const code = normalizeCode(typeof body.code === "string" ? body.code : "");
    if (!code) {
      return Response.json({ error: "Kode affiliate wajib diisi." }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if (body.displayName !== undefined) {
      const displayName =
        typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (displayName.length < 3 || displayName.length > 80) {
        return Response.json(
          { error: "Display name wajib 3–80 karakter." },
          { status: 400 },
        );
      }
      updates.display_name = displayName;
    }

    if (body.commissionRate !== undefined) {
      const commissionRate = Number(body.commissionRate);
      if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1) {
        return Response.json(
          { error: "Commission rate harus antara 0 dan 1." },
          { status: 400 },
        );
      }
      updates.commission_rate = commissionRate;
    }

    if (body.userBenefitType !== undefined) {
      const userBenefitType =
        typeof body.userBenefitType === "string" ? body.userBenefitType.trim() : "";
      if (!BENEFIT_TYPES.has(userBenefitType)) {
        return Response.json(
          { error: "User benefit type harus flat atau percentage." },
          { status: 400 },
        );
      }
      updates.user_benefit_type = userBenefitType;
    }

    if (body.userBenefitValue !== undefined) {
      const userBenefitValue = Number(body.userBenefitValue);
      if (!Number.isFinite(userBenefitValue) || userBenefitValue < 0) {
        return Response.json(
          { error: "User benefit value tidak boleh negatif." },
          { status: 400 },
        );
      }
      updates.user_benefit_value = userBenefitValue;
    }

    if (body.minimumOrder !== undefined) {
      const minimumOrder = Math.round(Number(body.minimumOrder));
      if (!Number.isFinite(minimumOrder) || minimumOrder < 0) {
        return Response.json(
          { error: "Minimum order tidak boleh negatif." },
          { status: 400 },
        );
      }
      updates.minimum_order = minimumOrder;
    }

    if (body.maxUserBenefit !== undefined) {
      const maxUserBenefit =
        body.maxUserBenefit === null || body.maxUserBenefit === ""
          ? null
          : Math.round(Number(body.maxUserBenefit));
      if (maxUserBenefit !== null && (!Number.isFinite(maxUserBenefit) || maxUserBenefit < 0)) {
        return Response.json(
          { error: "Max user benefit tidak boleh negatif." },
          { status: 400 },
        );
      }
      updates.max_user_benefit = maxUserBenefit;
    }

    if (body.stackableWithPromotions !== undefined) {
      updates.stackable_with_promotions = Boolean(body.stackableWithPromotions);
    }

    if (body.status !== undefined) {
      const status = typeof body.status === "string" ? body.status.trim() : "";
      if (!AFFILIATE_STATUSES.has(status)) {
        return Response.json(
          { error: "Status harus active, inactive, atau suspended." },
          { status: 400 },
        );
      }
      updates.status = status;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json(
        { error: "Tidak ada perubahan yang dikirim." },
        { status: 400 },
      );
    }
    updates.updated_at = new Date().toISOString();

    const rows = await supabaseUpdate<{ code: string }>("affiliates", updates, {
      filters: { code: `eq.${code}` },
    });
    if (rows.length === 0) {
      return Response.json({ error: "Affiliate tidak ditemukan." }, { status: 404 });
    }

    await auditAdminAction(request, {
      action: "affiliate.update",
      targetType: "affiliate",
      targetId: code,
      metadata: updates,
    });

    return Response.json({ affiliate: { code }, updated: Object.keys(updates) });
  } catch (error) {
    console.error("Affiliate update failed", error);
    return Response.json(
      { error: "Affiliate gagal diperbarui." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code") ?? "");
    if (!code) {
      return Response.json({ error: "Kode affiliate wajib diisi." }, { status: 400 });
    }

    // Kode affiliate direferensikan commissions & withdrawals (FK). Menghapus
    // affiliate bersejarah merusak ledger — tolak dan arahkan ke suspend.
    const [commissionRefs, withdrawalRefs] = await Promise.all([
      supabaseSelect<{ id: number }>("commissions", {
        select: "id",
        filters: { affiliate_code: `eq.${code}` },
        limit: 1,
      }),
      supabaseSelect<{ id: number }>("affiliate_withdrawals", {
        select: "id",
        filters: { affiliate_code: `eq.${code}` },
        limit: 1,
      }),
    ]);

    if (commissionRefs.length > 0 || withdrawalRefs.length > 0) {
      return Response.json(
        {
          error:
            `Kode ${code} memiliki riwayat komisi/withdrawal dan tidak dapat dihapus. ` +
            "Ubah status ke suspended supaya tidak bisa dipakai lagi.",
        },
        { status: 409 },
      );
    }

    const deleted = await supabaseDelete<{ code: string }>("affiliates", {
      filters: { code: `eq.${code}` },
    });
    if (deleted.length === 0) {
      return Response.json({ error: "Affiliate tidak ditemukan." }, { status: 404 });
    }

    await auditAdminAction(request, {
      action: "affiliate.delete",
      targetType: "affiliate",
      targetId: code,
    });

    return Response.json({ deleted: code });
  } catch (error) {
    console.error("Affiliate delete failed", error);
    return Response.json(
      { error: "Affiliate gagal dihapus." },
      { status: 502 },
    );
  }
}
