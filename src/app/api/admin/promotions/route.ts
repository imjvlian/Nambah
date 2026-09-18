import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  supabaseDelete,
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

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
  quota: number | null;
  quota_per_user: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type TargetRow = {
  promotion_code: string;
  product_id: string;
};

type RedemptionRow = {
  promotion_code: string;
  status: string;
};

function normalizeCode(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32)
    : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const [promotions, targets, redemptions] = await Promise.all([
      supabaseSelect<PromotionRow>("promotions", {
        select:
          "code,name,type,value,minimum_order,max_discount,stackable_with_referral,starts_at,ends_at,quota,quota_per_user,active,created_at,updated_at",
        order: "created_at.desc",
        limit: 200,
      }),
      supabaseSelect<TargetRow>("promotion_products", {
        select: "promotion_code,product_id",
        limit: 5000,
      }),
      supabaseSelect<RedemptionRow>("promotion_redemptions", {
        select: "promotion_code,status",
        limit: 10000,
      }),
    ]);

    return Response.json({
      promotions: promotions.map((row) => ({
        code: row.code,
        name: row.name,
        type: row.type,
        value: Number(row.value),
        minimumOrder: Number(row.minimum_order),
        maxDiscount:
          row.max_discount === null ? null : Number(row.max_discount),
        stackableWithReferral: row.stackable_with_referral,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        quota: row.quota,
        quotaPerUser: row.quota_per_user,
        active: row.active,
        productIds: targets
          .filter((target) => target.promotion_code === row.code)
          .map((target) => target.product_id),
        reserved: redemptions.filter(
          (item) =>
            item.promotion_code === row.code && item.status === "reserved",
        ).length,
        redeemed: redemptions.filter(
          (item) =>
            item.promotion_code === row.code && item.status === "redeemed",
        ).length,
      })),
    });
  } catch (error) {
    console.error("Admin promotions GET failed", error);
    return Response.json(
      { error: "Promo tidak dapat dimuat." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const code = normalizeCode(body.code);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const type = body.type === "percentage" ? "percentage" : "flat";
    const value = Number(body.value);
    const minimumOrder = Math.max(0, Math.round(Number(body.minimumOrder) || 0));
    const maxDiscount = numberOrNull(body.maxDiscount);
    const quota = numberOrNull(body.quota);
    const quotaPerUser = numberOrNull(body.quotaPerUser);
    const productIds = Array.isArray(body.productIds)
      ? body.productIds
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 500)
      : [];

    if (!code || !name || !Number.isFinite(value) || value < 0) {
      return Response.json({ error: "Data promo tidak valid." }, { status: 400 });
    }

    await supabaseInsert("promotions", {
      code,
      name,
      type,
      value,
      minimum_order: minimumOrder,
      max_discount:
        maxDiscount === null ? null : Math.max(0, Math.round(maxDiscount)),
      stackable_with_referral: body.stackableWithReferral !== false,
      starts_at:
        typeof body.startsAt === "string" && body.startsAt ? body.startsAt : null,
      ends_at:
        typeof body.endsAt === "string" && body.endsAt ? body.endsAt : null,
      quota: quota === null ? null : Math.max(0, Math.round(quota)),
      quota_per_user:
        quotaPerUser === null ? null : Math.max(0, Math.round(quotaPerUser)),
      active: body.active !== false,
      updated_at: new Date().toISOString(),
    });

    if (productIds.length > 0) {
      await supabaseInsert(
        "promotion_products",
        productIds.map((productId) => ({
          promotion_code: code,
          product_id: productId,
        })),
      );
    }

    await auditAdminAction(request, {
      action: "promotion.create",
      targetType: "promotion",
      targetId: code,
      metadata: { active: body.active !== false, type, value },
    });
    return Response.json({ ok: true, code });
  } catch (error) {
    console.error("Admin promotions POST failed", error);
    return Response.json(
      {
        error:
          error instanceof Error && /duplicate/i.test(error.message)
            ? "Kode promo sudah digunakan."
            : "Promo gagal dibuat.",
      },
      { status: 409 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const code = normalizeCode(body.code);
    if (!code) {
      return Response.json({ error: "Kode promo tidak valid." }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 120);
    if (body.type === "flat" || body.type === "percentage") patch.type = body.type;
    if (body.value !== undefined) patch.value = Math.max(0, Number(body.value) || 0);
    if (body.minimumOrder !== undefined) {
      patch.minimum_order = Math.max(0, Math.round(Number(body.minimumOrder) || 0));
    }
    if (body.maxDiscount !== undefined) {
      const value = numberOrNull(body.maxDiscount);
      patch.max_discount = value === null ? null : Math.max(0, Math.round(value));
    }
    if (body.quota !== undefined) {
      const value = numberOrNull(body.quota);
      patch.quota = value === null ? null : Math.max(0, Math.round(value));
    }
    if (body.quotaPerUser !== undefined) {
      const value = numberOrNull(body.quotaPerUser);
      patch.quota_per_user =
        value === null ? null : Math.max(0, Math.round(value));
    }
    if (typeof body.active === "boolean") patch.active = body.active;
    if (typeof body.stackableWithReferral === "boolean") {
      patch.stackable_with_referral = body.stackableWithReferral;
    }
    if (body.startsAt !== undefined) {
      patch.starts_at =
        typeof body.startsAt === "string" && body.startsAt ? body.startsAt : null;
    }
    if (body.endsAt !== undefined) {
      patch.ends_at =
        typeof body.endsAt === "string" && body.endsAt ? body.endsAt : null;
    }

    await supabaseUpdate("promotions", patch, {
      filters: { code: "eq." + code },
    });

    if (Array.isArray(body.productIds)) {
      await supabaseDelete("promotion_products", {
        filters: { promotion_code: "eq." + code },
      });
      const productIds = body.productIds
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 500);
      if (productIds.length > 0) {
        await supabaseInsert(
          "promotion_products",
          productIds.map((productId) => ({
            promotion_code: code,
            product_id: productId,
          })),
        );
      }
    }

    await auditAdminAction(request, {
      action: "promotion.update",
      targetType: "promotion",
      targetId: code,
      metadata: {
        fields: Object.keys(body).filter((key) => key !== "code"),
      },
    });
    return Response.json({ ok: true, code });
  } catch (error) {
    console.error("Admin promotions PATCH failed", error);
    return Response.json(
      { error: "Promo gagal diperbarui." },
      { status: 502 },
    );
  }
}
