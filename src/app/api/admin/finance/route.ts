import { authorizeAdminRequest } from "@/lib/admin-api";
import { runFinancialReconciliation } from "@/lib/financial-reconciliation";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type SnapshotRow = {
  order_id: string;
  result: "ok" | "warning" | "error";
  issues: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    expected?: number | string;
    actual?: number | string;
  }>;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  checked_at: string;
};

async function snapshots() {
  const rows = await supabaseSelect<SnapshotRow>("financial_reconciliations", {
    select: "order_id,result,issues,expected,actual,checked_at",
    order: "checked_at.desc",
    limit: 200,
  });

  return {
    stats: {
      checked: rows.length,
      ok: rows.filter((row) => row.result === "ok").length,
      warning: rows.filter((row) => row.result === "warning").length,
      error: rows.filter((row) => row.result === "error").length,
    },
    rows: rows.map((row) => ({
      orderId: row.order_id,
      result: row.result,
      issues: row.issues ?? [],
      expected: row.expected ?? {},
      actual: row.actual ?? {},
      checkedAt: row.checked_at,
    })),
  };
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    return Response.json(await snapshots());
  } catch (error) {
    console.error("Admin finance GET failed", error);
    return Response.json(
      { error: "Financial reconciliation belum dapat dimuat." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runFinancialReconciliation(100);
    return Response.json(result);
  } catch (error) {
    console.error("Admin finance reconciliation failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Financial reconciliation gagal.",
      },
      { status: 502 },
    );
  }
}
