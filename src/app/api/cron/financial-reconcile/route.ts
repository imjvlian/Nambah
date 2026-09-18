import { authorizeCronRequest } from "@/lib/cron-api";
import { runFinancialReconciliation } from "@/lib/financial-reconciliation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runFinancialReconciliation(100);
    return Response.json({
      checked: result.checked,
      ok: result.ok,
      warning: result.warning,
      errors: result.errors,
    });
  } catch (error) {
    console.error("Financial reconciliation cron failed", error);
    return Response.json(
      { error: "Financial reconciliation cron gagal." },
      { status: 502 },
    );
  }
}
