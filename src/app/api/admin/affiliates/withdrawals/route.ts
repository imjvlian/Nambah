import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
  processed_by_user_id: string | null;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rows = await supabaseSelect<WithdrawalRow>("affiliate_withdrawals", {
      select:
        "id,affiliate_code,amount,method,account_name,account_number,status,requested_at,processed_at,paid_at,rejection_reason,external_reference,processed_by_user_id",
      order: "requested_at.desc",
      limit: 200,
    });

    return Response.json({
      withdrawals: rows.map((row) => ({
        id: row.id,
        affiliateCode: row.affiliate_code,
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
        processedByUserId: row.processed_by_user_id,
      })),
    });
  } catch (error) {
    console.error("Admin affiliate withdrawals GET failed", error);
    return Response.json(
      { error: "Withdrawal affiliate gagal dimuat." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const withdrawalId = Number(body.withdrawalId);
    const action =
      typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const externalReference =
      typeof body.externalReference === "string"
        ? body.externalReference.trim().slice(0, 200)
        : "";

    if (!Number.isSafeInteger(withdrawalId) || withdrawalId <= 0) {
      return Response.json({ error: "Withdrawal ID tidak valid." }, { status: 400 });
    }

    if (!["approve", "reject", "paid"].includes(action)) {
      return Response.json({ error: "Action withdrawal tidak valid." }, { status: 400 });
    }

    if (action === "reject" && reason.length < 3) {
      return Response.json(
        { error: "Alasan penolakan minimal 3 karakter." },
        { status: 400 },
      );
    }

    if (action === "paid" && externalReference.length < 3) {
      return Response.json(
        { error: "Reference pembayaran wajib diisi sebelum mark paid." },
        { status: 400 },
      );
    }

    const result = await supabaseRpc<Record<string, unknown>>(
      "nambah_affiliate_transition_withdrawal",
      {
        p_withdrawal_id: withdrawalId,
        p_action: action,
        p_actor_user_id: auth.principal.userId,
        p_reason: reason || null,
        p_external_reference: externalReference || null,
      },
    );

    await auditAdminAction(request, {
      action: "affiliate.withdrawal." + action,
      targetType: "affiliate_withdrawal",
      targetId: String(withdrawalId),
      metadata: {
        reason: reason || null,
        externalReference: externalReference || null,
      },
    });

    return Response.json({ withdrawal: result });
  } catch (error) {
    console.error("Admin affiliate withdrawal PATCH failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Withdrawal affiliate gagal diperbarui.",
      },
      { status: 409 },
    );
  }
}
