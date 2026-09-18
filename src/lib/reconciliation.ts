import {
  runDigiflazzTestTransaction,
  type DigiflazzTestOutcome,
} from "@/lib/digiflazz/client";
import { applyDigiflazzTransactionStatus } from "@/lib/digiflazz/status-service";
import {
  fulfillPaidOrder,
  getFulfillmentMode,
} from "@/lib/fulfillment";
import { deliverSuccessReceipt } from "@/lib/receipt-service";
import { supabaseSelect } from "@/lib/supabase/server";

type ReconcileSource = "admin" | "cron";

type PendingSupplierRow = {
  id: number;
  order_id: string;
  request_ref: string;
  supplier_transaction_id: string | null;
  status: "pending";
  updated_at: string;
};

type RecoverableOrderRow = {
  id: string;
  status: "paid" | "processing";
  updated_at: string;
};

type ReceiptDeliveryRow = {
  id: number;
  order_id: string;
  status: "failed" | "sending";
  attempts: number | string;
  last_error: string | null;
  updated_at: string;
};

export type ReconciliationResult = {
  source: ReconcileSource;
  startedAt: string;
  finishedAt: string;
  fulfillmentMode: string;
  orders: {
    checked: number;
    recovered: number;
    pending: number;
    failed: number;
  };
  supplier: {
    checked: number;
    applied: number;
    stillPending: number;
    skipped: number;
    failed: number;
  };
  receipts: {
    retried: number;
    sent: number;
    stillFailed: number;
    staleSending: number;
  };
  issues: Array<{
    kind: "order" | "supplier" | "receipt";
    id: string;
    message: string;
  }>;
};

const MIN_ORDER_AGE_MS = 60_000;
const RECEIPT_RETRY_AGE_MS = 5 * 60_000;
const STALE_SENDING_AGE_MS = 15 * 60_000;
const MAX_RECEIPT_ATTEMPTS = 3;
const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

function before(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

function configuredTestOutcome(): DigiflazzTestOutcome {
  const value =
    process.env.NAMBAH_DIGIFLAZZ_TEST_OUTCOME?.trim().toLowerCase() ||
    "success";
  if (
    value === "success" ||
    value === "failed" ||
    value === "pending-success" ||
    value === "pending-failed"
  ) {
    return value;
  }
  return "success";
}

function safeLimit(value?: number) {
  if (!Number.isInteger(value)) return DEFAULT_BATCH;
  return Math.max(1, Math.min(MAX_BATCH, Number(value)));
}

function issue(
  result: ReconciliationResult,
  kind: "order" | "supplier" | "receipt",
  id: string,
  error: unknown,
) {
  result.issues.push({
    kind,
    id,
    message:
      error instanceof Error
        ? error.message.slice(0, 500)
        : String(error).slice(0, 500),
  });
}

export async function runNambahReconciliation(input?: {
  source?: ReconcileSource;
  limit?: number;
}): Promise<ReconciliationResult> {
  const source = input?.source ?? "cron";
  const limit = safeLimit(input?.limit);
  const startedAt = new Date().toISOString();
  const fulfillmentMode = getFulfillmentMode();

  const result: ReconciliationResult = {
    source,
    startedAt,
    finishedAt: startedAt,
    fulfillmentMode,
    orders: {
      checked: 0,
      recovered: 0,
      pending: 0,
      failed: 0,
    },
    supplier: {
      checked: 0,
      applied: 0,
      stillPending: 0,
      skipped: 0,
      failed: 0,
    },
    receipts: {
      retried: 0,
      sent: 0,
      stillFailed: 0,
      staleSending: 0,
    },
    issues: [],
  };

  const recoverableOrders = await supabaseSelect<RecoverableOrderRow>("orders", {
    select: "id,status,updated_at",
    filters: {
      status: "in.(paid,processing)",
      updated_at: `lt.${before(MIN_ORDER_AGE_MS)}`,
    },
    order: "updated_at.asc",
    limit,
  });

  for (const order of recoverableOrders) {
    result.orders.checked += 1;
    try {
      const recovery = await fulfillPaidOrder(order.id);
      if (recovery.status === "success") {
        result.orders.recovered += 1;
      } else if (recovery.status === "failed") {
        result.orders.failed += 1;
      } else {
        result.orders.pending += 1;
      }
    } catch (error) {
      result.orders.failed += 1;
      issue(result, "order", order.id, error);
    }
  }

  const pendingSupplier = await supabaseSelect<PendingSupplierRow>(
    "supplier_transactions",
    {
      select:
        "id,order_id,request_ref,supplier_transaction_id,status,updated_at",
      filters: {
        supplier_id: "eq.digiflazz",
        status: "eq.pending",
        updated_at: `lt.${before(MIN_ORDER_AGE_MS)}`,
      },
      order: "updated_at.asc",
      limit,
    },
  );

  for (const transaction of pendingSupplier) {
    result.supplier.checked += 1;

    if (fulfillmentMode !== "digiflazz-test") {
      // Production/live re-query remains locked until Nambah has the final
      // per-game customer_no formatter. Webhook remains primary in that mode.
      result.supplier.skipped += 1;
      continue;
    }

    try {
      const supplierResult = await runDigiflazzTestTransaction({
        outcome: configuredTestOutcome(),
        refId: transaction.request_ref,
      });
      const applied = await applyDigiflazzTransactionStatus(supplierResult);

      if (applied.supplierTransactionStatus === "pending") {
        result.supplier.stillPending += 1;
      } else if (
        applied.supplierTransactionStatus === "success" ||
        applied.supplierTransactionStatus === "failed"
      ) {
        result.supplier.applied += 1;
      } else {
        result.supplier.skipped += 1;
      }
    } catch (error) {
      result.supplier.failed += 1;
      issue(result, "supplier", transaction.request_ref, error);
    }
  }

  const failedReceipts = await supabaseSelect<ReceiptDeliveryRow>(
    "receipt_deliveries",
    {
      select: "id,order_id,status,attempts,last_error,updated_at",
      filters: {
        channel: "eq.email",
        status: "eq.failed",
        attempts: `lt.${MAX_RECEIPT_ATTEMPTS}`,
        updated_at: `lt.${before(RECEIPT_RETRY_AGE_MS)}`,
      },
      order: "updated_at.asc",
      limit,
    },
  );

  for (const receipt of failedReceipts) {
    result.receipts.retried += 1;
    try {
      const delivery = await deliverSuccessReceipt(receipt.order_id);
      if (delivery.status === "sent") {
        result.receipts.sent += 1;
      } else {
        result.receipts.stillFailed += 1;
      }
    } catch (error) {
      result.receipts.stillFailed += 1;
      issue(result, "receipt", receipt.order_id, error);
    }
  }

  const staleSending = await supabaseSelect<ReceiptDeliveryRow>(
    "receipt_deliveries",
    {
      select: "id,order_id,status,attempts,last_error,updated_at",
      filters: {
        channel: "eq.email",
        status: "eq.sending",
        updated_at: `lt.${before(STALE_SENDING_AGE_MS)}`,
      },
      order: "updated_at.asc",
      limit,
    },
  );

  // Never auto-retry stale "sending": Brevo may already have accepted the
  // message before the local sent state was persisted. Surface these for
  // manual/provider reconciliation to avoid duplicate receipts.
  result.receipts.staleSending = staleSending.length;

  result.finishedAt = new Date().toISOString();
  return result;
}
