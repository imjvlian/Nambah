import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase/server";
export const runtime = "nodejs";

type AffiliateSummary = {
  affiliate: null | {
    code: string;
    displayName: string;
    commissionRate: number | string;
    status: string;
    pending: number | string;
    /** Komisi sudah jadi tapi belum lewat masa tunggu 3 hari. */
    maturing: number | string;
    available: number | string;
    reserved: number | string;
    withdrawn: number | string;
  };
};

type WithdrawalRow = {
  id: number;
  affiliate_code: string;
  amount: number | string;
  method: string;
  account_name: string;
  account_number: string;
  status: string;
  requested_at: string;
  processed_at: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  external_reference: string | null;
};

/**
 * Minimal pencairan komisi dari app_settings (P1.4) - sumber yang sama
 * dengan yang dibaca RPC, jadi UI dan server tidak pernah berbeda
 * pendapat. Gagal baca -> default 10000 (nilai bawaan migrasi 058).
 */
async function readMinPayout(): Promise<number> {
  try {
    const [row] = await supabaseSelect<{ value: unknown }>("app_settings", {
      select: "value",
      filters: { key: "eq.affiliate_min_payout" },
      limit: 1,
    });
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  } catch (error) {
    console.warn("Gagal membaca affiliate_min_payout, memakai default.", error);
    return 10000;
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveNambahAuth(request);
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    const summary = await supabaseRpc<AffiliateSummary>(
      "nambah_affiliate_summary",
      { p_user_id: auth.user.id },
    );

    if (!summary?.affiliate) {
      return Response.json({ affiliate: null, withdrawals: [], minPayout: await readMinPayout() }, { headers });
    }

    const withdrawals = await supabaseSelect<WithdrawalRow>(
      "affiliate_withdrawals",
      {
        select:
          "id,affiliate_code,amount,method,account_name,account_number,status,requested_at,processed_at,paid_at,rejection_reason,external_reference",
        filters: { affiliate_code: "eq." + summary.affiliate.code },
        order: "requested_at.desc",
        limit: 30,
      },
    );

    return Response.json(
      {
        affiliate: {
          ...summary.affiliate,
          commissionRate: Number(summary.affiliate.commissionRate),
          pending: Number(summary.affiliate.pending),
          maturing: Number(summary.affiliate.maturing ?? 0),
          available: Number(summary.affiliate.available),
          reserved: Number(summary.affiliate.reserved),
          withdrawn: Number(summary.affiliate.withdrawn),
        },
        /*
         * Minimal pencairan (P1.4) - dibaca dari app_settings supaya UI
         * bisa menampilkan dan memvalidasinya tanpa deploy ulang.
         */
        minPayout: await readMinPayout(),
        withdrawals: withdrawals.map((row) => ({
          id: row.id,
          amount: Number(row.amount),
          method: row.method,
          accountName: row.account_name,
          accountNumber: row.account_number,
          status: row.status,
          requestedAt: row.requested_at,
          processedAt: row.processed_at,
          paidAt: row.paid_at,
          rejectionReason: row.rejection_reason,
          externalReference: row.external_reference,
        })),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Affiliate account GET failed", error);
    return Response.json(
      { error: "Data mitra belum dapat dimuat." },
      { status: 503 },
    );
  }
}
