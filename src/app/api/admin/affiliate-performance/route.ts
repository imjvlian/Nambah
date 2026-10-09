import { authorizeAdminRequest } from "@/lib/admin-api";
import { conversionRate } from "@/lib/affiliate-attribution";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Monitor kinerja affiliate.
 *
 * Angka komisi TIDAK dihitung ulang di sini — `commissions` sudah terisi
 * otomatis oleh `commission-service.ts` saat order berjalan. Endpoint ini
 * hanya menjumlahkan.
 *
 * Konversi sengaja `null` kalau klik 0, bukan 0. "0 klik, 0 pesanan → 0%"
 * menyesatkan: affiliate yang belum pernah dipromosikan terlihat sama dengan
 * affiliate yang 1000 klik tapi tidak ada yang beli.
 */

type AffiliateRow = {
  code: string;
  display_name: string;
  user_id: string | null;
  commission_rate: number | string;
  status: string;
  created_at: string;
};

type ClickRow = {
  affiliate_code: string;
  clicked_at: string;
};

type CommissionRow = {
  affiliate_code: string;
  amount: number | string;
  status: "pending" | "available" | "withdrawn" | "cancelled";
};

type WithdrawalRow = {
  affiliate_code: string;
  amount: number | string;
  status: "pending" | "approved" | "paid" | "rejected" | "cancelled";
};

const CLICK_WINDOW_DAYS = 30;

function sumBy(rows: Array<{ amount: number | string }>) {
  return rows.reduce((total, row) => total + Math.max(0, Number(row.amount)), 0);
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const daysParam = Number(url.searchParams.get("days") ?? CLICK_WINDOW_DAYS);
    const days =
      Number.isFinite(daysParam) && daysParam > 0
        ? Math.min(365, Math.floor(daysParam))
        : CLICK_WINDOW_DAYS;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [affiliates, clicks, commissions, withdrawals] = await Promise.all([
      supabaseSelect<AffiliateRow>("affiliates", {
        select: "code,display_name,user_id,commission_rate,status,created_at",
        order: "created_at.desc",
        limit: 500,
      }),
      supabaseSelect<ClickRow>("affiliate_clicks", {
        select: "affiliate_code,clicked_at",
        filters: { clicked_at: `gte.${since}` },
        limit: 10_000,
      }),
      supabaseSelect<CommissionRow>("commissions", {
        select: "affiliate_code,amount,status",
        limit: 10_000,
      }),
      supabaseSelect<WithdrawalRow>("affiliate_withdrawals", {
        select: "affiliate_code,amount,status",
        filters: { status: "in.(approved,paid)" },
        limit: 10_000,
      }),
    ]);

    const clicksByCode = new Map<string, number>();
    for (const click of clicks) {
      clicksByCode.set(
        click.affiliate_code,
        (clicksByCode.get(click.affiliate_code) ?? 0) + 1,
      );
    }

    const commissionsByCode = new Map<
      string,
      { orders: number; pending: number; available: number; withdrawn: number; lifetime: number }
    >();

    for (const commission of commissions) {
      const amount = Math.max(0, Number(commission.amount));
      const bucket =
        commissionsByCode.get(commission.affiliate_code) ??
        { orders: 0, pending: 0, available: 0, withdrawn: 0, lifetime: 0 };

      // `orders` dihitung dari commission yang tidak batal. Commission batal
      // tetap tercatat di tabel supaya riwayatnya tidak hilang, tapi tidak
      // boleh ikut dihitung sebagai penjualan.
      if (commission.status === "cancelled") continue;

      bucket.orders += 1;
      bucket.lifetime += amount;
      if (commission.status === "pending") bucket.pending += amount;
      if (commission.status === "available") bucket.available += amount;
      if (commission.status === "withdrawn") bucket.withdrawn += amount;

      commissionsByCode.set(commission.affiliate_code, bucket);
    }

    const withdrawnByCode = new Map<string, number>();
    for (const withdrawal of withdrawals) {
      withdrawnByCode.set(
        withdrawal.affiliate_code,
        (withdrawnByCode.get(withdrawal.affiliate_code) ?? 0) +
          Math.max(0, Number(withdrawal.amount)),
      );
    }

    const rows = affiliates.map((affiliate) => {
      const commission = commissionsByCode.get(affiliate.code);
      const clickCount = clicksByCode.get(affiliate.code) ?? 0;
      const orders = commission?.orders ?? 0;

      return {
        code: affiliate.code,
        displayName: affiliate.display_name,
        // `user_id` null = program bawaan, bukan affiliate dengan pemilik.
        // Linknya tidak bisa dipakai — `/r/[code]` menolak yang begini.
        hasOwner: Boolean(affiliate.user_id),
        status: affiliate.status,
        commissionRate: Number(affiliate.commission_rate),
        clicks: clickCount,
        orders,
        conversion: conversionRate(clickCount, orders),
        commissionPending: commission?.pending ?? 0,
        commissionAvailable: commission?.available ?? 0,
        commissionWithdrawn: withdrawnByCode.get(affiliate.code) ?? 0,
        commissionLifetime: commission?.lifetime ?? 0,
        createdAt: affiliate.created_at,
      };
    });

    rows.sort((left, right) => right.commissionLifetime - left.commissionLifetime);

    const totals = rows.reduce(
      (accumulator, row) => ({
        affiliates: accumulator.affiliates + 1,
        active: accumulator.active + (row.status === "active" ? 1 : 0),
        clicks: accumulator.clicks + row.clicks,
        orders: accumulator.orders + row.orders,
        commissionLifetime:
          accumulator.commissionLifetime + row.commissionLifetime,
        commissionAvailable:
          accumulator.commissionAvailable + row.commissionAvailable,
      }),
      {
        affiliates: 0,
        active: 0,
        clicks: 0,
        orders: 0,
        commissionLifetime: 0,
        commissionAvailable: 0,
      },
    );

    return Response.json({ rows, totals, windowDays: days });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Data affiliate tidak dapat dimuat.",
      },
      { status: 500 },
    );
  }
}
