import { authorizeCronRequest } from "@/lib/cron-api";
import { runNambahReconciliation } from "@/lib/reconciliation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runNambahReconciliation({
      source: "cron",
      limit: 20,
    });
    return Response.json(result);
  } catch (error) {
    console.error("Nambah reconciliation cron failed", error);
    return Response.json(
      { error: "Reconciliation gagal dijalankan." },
      { status: 502 },
    );
  }
}
