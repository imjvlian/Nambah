import { randomUUID } from "node:crypto";
import { authorizeAdminRequest } from "@/lib/admin-api";
import {
  runDigiflazzTestTransaction,
  type DigiflazzTestOutcome,
} from "@/lib/digiflazz/client";

export const runtime = "nodejs";

const allowedOutcomes = new Set<DigiflazzTestOutcome>([
  "success",
  "failed",
  "pending-success",
  "pending-failed",
]);

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: { outcome?: DigiflazzTestOutcome; refId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request test transaksi tidak valid." }, { status: 400 });
  }

  const outcome = body.outcome ?? "success";
  if (!allowedOutcomes.has(outcome)) {
    return Response.json(
      { error: "Outcome harus success, failed, pending-success, atau pending-failed." },
      { status: 400 },
    );
  }

  const refId =
    body.refId?.trim() || `nambah-test-${Date.now()}-${randomUUID().slice(0, 8)}`;

  try {
    const data = await runDigiflazzTestTransaction({ outcome, refId });

    return Response.json({
      mode: "testing",
      requestedOutcome: outcome,
      transaction: {
        refId: data.ref_id,
        customerNo: data.customer_no,
        sku: data.buyer_sku_code,
        status: data.status,
        rc: data.rc,
        message: data.message,
        serialNumber: data.sn ?? null,
        supplierPrice: Number(data.price),
        buyerLastBalance:
          data.buyer_last_saldo === undefined ? null : Number(data.buyer_last_saldo),
      },
    });
  } catch (error) {
    console.error("Digiflazz test transaction failed", error);
    return Response.json(
      { error: "Test transaksi Digiflazz gagal dijalankan." },
      { status: 502 },
    );
  }
}
