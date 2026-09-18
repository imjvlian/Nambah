import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { runNambahReconciliation } from "@/lib/reconciliation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runNambahReconciliation({
      source: "admin",
      limit: 20,
    });
    await auditAdminAction(request, {
      action: "reconciliation.run",
      targetType: "system",
      metadata: {
        ordersChecked: result.orders.checked,
        supplierChecked: result.supplier.checked,
        receiptsRetried: result.receipts.retried,
      },
    });
    return Response.json(result);
  } catch (error) {
    console.error("Admin reconciliation failed", error);
    return Response.json(
      { error: "Reconciliation admin gagal dijalankan." },
      { status: 502 },
    );
  }
}
