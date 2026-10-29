import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  supabaseDelete,
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type PaymentMethodRow = {
  id: string;
  name: string;
  detail: string;
  customer_fee_flat: number | string;
  customer_fee_percent: number | string;
  merchant_fee_flat: number | string;
  merchant_fee_percent: number | string;
  active: boolean;
  sort_order: number;
  updated_at: string;
};

const SELECT =
  "id,name,detail,customer_fee_flat,customer_fee_percent,merchant_fee_flat,merchant_fee_percent,active,sort_order,updated_at";

function mapRow(row: PaymentMethodRow) {
  return {
    id: row.id,
    name: row.name,
    detail: row.detail,
    customerFeeFlat: Number(row.customer_fee_flat ?? 0),
    customerFeePercent: Number(row.customer_fee_percent ?? 0),
    merchantFeeFlat: Number(row.merchant_fee_flat ?? 0),
    merchantFeePercent: Number(row.merchant_fee_percent ?? 0),
    active: row.active,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

function cleanNullable(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rows = await supabaseSelect<PaymentMethodRow>("payment_methods", {
      select: SELECT,
      order: "sort_order.asc",
      limit: 100,
    });
    return Response.json({ paymentMethods: rows.map(mapRow) });
  } catch (error) {
    console.error("Admin payment methods GET failed", error);
    return Response.json(
      { error: "Daftar metode pembayaran tidak dapat dimuat." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = String(body.id ?? "");
    if (!id) {
      return Response.json(
        { error: "ID metode pembayaran wajib diisi." },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {};

    if (body.customer_fee_flat !== undefined) {
      const flat = Number(body.customer_fee_flat);
      if (!Number.isFinite(flat) || flat < 0) {
        return Response.json(
          { error: "Biaya flat harus berupa angka >= 0." },
          { status: 400 },
        );
      }
      updates.customer_fee_flat = Math.round(flat);
    }

    if (body.customer_fee_percent !== undefined) {
      const pct = Number(body.customer_fee_percent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return Response.json(
          { error: "Biaya persen harus berupa angka 0–100." },
          { status: 400 },
        );
      }
      updates.customer_fee_percent = Number(pct.toFixed(4));
    }

    if (body.name !== undefined) {
      const name = cleanNullable(body.name, 100);
      if (!name) {
        return Response.json(
          { error: "Nama metode pembayaran wajib diisi." },
          { status: 400 },
        );
      }
      updates.name = name;
    }

    if (body.detail !== undefined) {
      updates.detail = cleanNullable(body.detail, 200);
    }

    if (body.active !== undefined) updates.active = Boolean(body.active);

    if (Object.keys(updates).length === 0) {
      return Response.json(
        { error: "Tidak ada perubahan yang dikirim." },
        { status: 400 },
      );
    }
    updates.updated_at = new Date().toISOString();

    const rows = await supabaseUpdate<PaymentMethodRow>(
      "payment_methods",
      updates,
      { filters: { id: `eq.${id}` } },
    );
    if (rows.length === 0) {
      return Response.json({ error: "Metode pembayaran tidak ditemukan." }, { status: 404 });
    }

    await auditAdminAction(request, {
      action: "payment_method.update",
      targetType: "payment_method",
      targetId: id,
      metadata: updates,
    });

    return Response.json({ paymentMethod: mapRow(rows[0]) });
  } catch (error) {
    console.error("Admin payment method update failed", error);
    return Response.json(
      { error: "Metode pembayaran gagal diperbarui." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return Response.json(
        { error: "ID metode pembayaran wajib diisi." },
        { status: 400 },
      );
    }

    const [existing] = await supabaseSelect<PaymentMethodRow>("payment_methods", {
      select: SELECT,
      filters: { id: `eq.${id}` },
      limit: 1,
    });
    if (!existing) {
      return Response.json({ error: "Metode pembayaran tidak ditemukan." }, { status: 404 });
    }

    await supabaseDelete("payment_methods", { filters: { id: `eq.${id}` } });

    await auditAdminAction(request, {
      action: "payment_method.delete",
      targetType: "payment_method",
      targetId: id,
      metadata: { name: existing.name },
    });

    return Response.json({ deleted: id });
  } catch (error) {
    console.error("Admin payment method delete failed", error);
    return Response.json(
      { error: "Metode pembayaran gagal dihapus." },
      { status: 502 },
    );
  }
}
