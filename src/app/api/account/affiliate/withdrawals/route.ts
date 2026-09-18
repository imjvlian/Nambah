import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { rateLimitResponse } from "@/lib/rate-limit";
import { supabaseRpc } from "@/lib/supabase/server";

export const runtime = "nodejs";

function clean(value: unknown, max: number) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, max)
    : "";
}

export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, {
    scope: "affiliate-withdrawal",
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (limited) return limited;

  try {
    const auth = await resolveNambahAuth(request);
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const amount = Number(body.amount);
    const method = clean(body.method, 80);
    const accountName = clean(body.accountName, 120);
    const accountNumber = clean(body.accountNumber, 120);

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return Response.json(
        { error: "Nominal withdrawal tidak valid." },
        { status: 400, headers },
      );
    }

    if (method.length < 2 || accountName.length < 2 || accountNumber.length < 4) {
      return Response.json(
        { error: "Data rekening withdrawal belum lengkap." },
        { status: 400, headers },
      );
    }

    const result = await supabaseRpc<Record<string, unknown>>(
      "nambah_affiliate_request_withdrawal",
      {
        p_user_id: auth.user.id,
        p_amount: amount,
        p_method: method,
        p_account_name: accountName,
        p_account_number: accountNumber,
      },
    );

    return Response.json({ withdrawal: result }, { status: 201, headers });
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Affiliate withdrawal request failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message.replace(/^Supabase RPC [^:]+ failed \(\d+\):\s*/, "")
            : "Withdrawal gagal dibuat.",
      },
      { status: 409 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await resolveNambahAuth(request);
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const withdrawalId = Number(body.withdrawalId);
    if (!Number.isSafeInteger(withdrawalId) || withdrawalId <= 0) {
      return Response.json(
        { error: "Withdrawal ID tidak valid." },
        { status: 400, headers },
      );
    }

    const result = await supabaseRpc<Record<string, unknown>>(
      "nambah_affiliate_cancel_withdrawal",
      {
        p_user_id: auth.user.id,
        p_withdrawal_id: withdrawalId,
      },
    );

    return Response.json({ withdrawal: result }, { headers });
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Affiliate withdrawal cancel failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Withdrawal gagal dibatalkan." },
      { status: 409 },
    );
  }
}
