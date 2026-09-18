import type { DigiflazzTransactionData } from "@/lib/digiflazz/client";
import { deliverSuccessReceipt } from "@/lib/receipt-service";
import { syncOrderPointsLifecycle } from "@/lib/loyalty";
import { syncOrderCommissionLifecycle } from "@/lib/commission-service";
import { syncPromotionLifecycle } from "@/lib/promotion-service";
import type { PublicOrderStatus } from "@/lib/order-public";
import {
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

type SupplierStatus = "pending" | "success" | "failed";

type SupplierTransactionRow = {
  id: number;
  order_id: string;
  supplier_id: string;
  product_id: string;
  request_ref: string;
  supplier_transaction_id: string | null;
  supplier_sku: string | null;
  target: string;
  cost: number | string;
  status: SupplierStatus;
  message: string | null;
  serial_number: string | null;
  created_at: string;
  updated_at: string;
};

type OrderRow = {
  id: string;
  status: PublicOrderStatus;
  paid_at: string | null;
  fulfilled_at: string | null;
  status_changed_at: string | null;
  terminal_at: string | null;
  updated_at: string;
};

export type DigiflazzApplyResult = {
  requestRef: string;
  orderId: string | null;
  callbackStatus: string;
  supplierStatus: SupplierStatus | "unknown";
  supplierTransactionStatus: SupplierStatus | null;
  orderStatus: PublicOrderStatus | null;
  applied: boolean;
  receiptTriggered: boolean;
  reason:
    | "applied"
    | "duplicate"
    | "unknown_request_ref"
    | "unsupported_status"
    | "sku_mismatch"
    | "supplier_terminal_conflict"
    | "order_missing"
    | "order_not_paid"
    | "order_terminal";
};

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeStatus(value: string): SupplierStatus | "unknown" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sukses" || normalized === "success") return "success";
  if (normalized === "gagal" || normalized === "failed") return "failed";
  if (normalized === "pending") return "pending";
  return "unknown";
}

function callbackMessage(data: DigiflazzTransactionData) {
  const rc = clean(data.rc, 40);
  const message = clean(data.message, 420);
  return `Digiflazz callback${rc ? ` [${rc}]` : ""}: ${message || data.status || "no message"}`;
}

async function getSupplierTransaction(requestRef: string) {
  const [row] = await supabaseSelect<SupplierTransactionRow>(
    "supplier_transactions",
    {
      select:
        "id,order_id,supplier_id,product_id,request_ref,supplier_transaction_id,supplier_sku,target,cost,status,message,serial_number,created_at,updated_at",
      filters: {
        supplier_id: "eq.digiflazz",
        request_ref: `eq.${requestRef}`,
      },
      limit: 1,
    },
  );
  return row ?? null;
}

async function getOrder(orderId: string) {
  const [row] = await supabaseSelect<OrderRow>("orders", {
    select:
      "id,status,paid_at,fulfilled_at,status_changed_at,terminal_at,updated_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });
  return row ?? null;
}

async function maybeSendReceipt(orderId: string) {
  try {
    const result = await deliverSuccessReceipt(orderId);
    return result.status === "sent" || result.status === "sending";
  } catch (error) {
    console.error(`Digiflazz callback receipt trigger failed for ${orderId}`, error);
    return false;
  }
}

async function updatePendingOrder(order: OrderRow) {
  if (order.status === "processing") return order;

  if (order.status !== "paid") return order;

  const now = new Date().toISOString();
  const updated = await supabaseUpdate<OrderRow>(
    "orders",
    {
      status: "processing",
      status_changed_at: now,
      terminal_at: null,
      updated_at: now,
    },
    {
      filters: {
        id: `eq.${order.id}`,
        status: "eq.paid",
      },
    },
  );

  return updated[0] ?? (await getOrder(order.id)) ?? order;
}

async function updateTerminalOrder(
  order: OrderRow,
  status: "success" | "failed",
) {
  if (
    order.status === "success" ||
    order.status === "failed" ||
    order.status === "refunded" ||
    order.status === "cancelled"
  ) {
    return order;
  }

  if (order.status !== "paid" && order.status !== "processing") {
    return order;
  }

  const now = new Date().toISOString();
  const updated = await supabaseUpdate<OrderRow>(
    "orders",
    {
      status,
      status_changed_at: now,
      terminal_at: now,
      ...(status === "success" ? { fulfilled_at: now } : {}),
      updated_at: now,
    },
    {
      filters: {
        id: `eq.${order.id}`,
        status: "in.(paid,processing)",
      },
    },
  );

  return updated[0] ?? (await getOrder(order.id)) ?? order;
}

export async function applyDigiflazzTransactionStatus(
  data: DigiflazzTransactionData,
): Promise<DigiflazzApplyResult> {
  const requestRef = clean(data.ref_id, 160);
  const callbackStatus = clean(data.status, 80);
  const incomingStatus = normalizeStatus(callbackStatus);

  if (!requestRef) {
    return {
      requestRef: "",
      orderId: null,
      callbackStatus,
      supplierStatus: incomingStatus,
      supplierTransactionStatus: null,
      orderStatus: null,
      applied: false,
      receiptTriggered: false,
      reason: "unknown_request_ref",
    };
  }

  const transaction = await getSupplierTransaction(requestRef);
  if (!transaction) {
    return {
      requestRef,
      orderId: null,
      callbackStatus,
      supplierStatus: incomingStatus,
      supplierTransactionStatus: null,
      orderStatus: null,
      applied: false,
      receiptTriggered: false,
      reason: "unknown_request_ref",
    };
  }

  const order = await getOrder(transaction.order_id);
  if (!order) {
    return {
      requestRef,
      orderId: transaction.order_id,
      callbackStatus,
      supplierStatus: incomingStatus,
      supplierTransactionStatus: transaction.status,
      orderStatus: null,
      applied: false,
      receiptTriggered: false,
      reason: "order_missing",
    };
  }

  if (incomingStatus === "unknown") {
    return {
      requestRef,
      orderId: order.id,
      callbackStatus,
      supplierStatus: "unknown",
      supplierTransactionStatus: transaction.status,
      orderStatus: order.status,
      applied: false,
      receiptTriggered: false,
      reason: "unsupported_status",
    };
  }

  const incomingSku = clean(data.buyer_sku_code, 160);
  if (
    transaction.supplier_sku &&
    incomingSku &&
    transaction.supplier_sku.toUpperCase() !== incomingSku.toUpperCase()
  ) {
    return {
      requestRef,
      orderId: order.id,
      callbackStatus,
      supplierStatus: incomingStatus,
      supplierTransactionStatus: transaction.status,
      orderStatus: order.status,
      applied: false,
      receiptTriggered: false,
      reason: "sku_mismatch",
    };
  }

  if (
    (transaction.status === "success" || transaction.status === "failed") &&
    transaction.status !== incomingStatus
  ) {
    return {
      requestRef,
      orderId: order.id,
      callbackStatus,
      supplierStatus: incomingStatus,
      supplierTransactionStatus: transaction.status,
      orderStatus: order.status,
      applied: false,
      receiptTriggered: false,
      reason: "supplier_terminal_conflict",
    };
  }

  const now = new Date().toISOString();
  const serialNumber = clean(data.sn, 500);
  const transactionPatch = {
    supplier_transaction_id: requestRef,
    ...(incomingSku ? { supplier_sku: incomingSku } : {}),
    status: incomingStatus,
    message: callbackMessage(data),
    ...(serialNumber ? { serial_number: serialNumber } : {}),
    updated_at: now,
  };

  let supplierUpdated = false;

  if (transaction.status === incomingStatus) {
    await supabaseUpdate(
      "supplier_transactions",
      transactionPatch,
      {
        filters: {
          id: `eq.${transaction.id}`,
          status: `eq.${incomingStatus}`,
        },
      },
    );
  } else {
    const updated = await supabaseUpdate<SupplierTransactionRow>(
      "supplier_transactions",
      transactionPatch,
      {
        filters: {
          id: `eq.${transaction.id}`,
          status: "eq.pending",
        },
      },
    );

    if (updated.length === 0) {
      const current = await getSupplierTransaction(requestRef);
      if (!current) {
        throw new Error(
          `Supplier transaction ${requestRef} hilang saat callback diproses.`,
        );
      }

      if (
        (current.status === "success" || current.status === "failed") &&
        current.status !== incomingStatus
      ) {
        return {
          requestRef,
          orderId: order.id,
          callbackStatus,
          supplierStatus: incomingStatus,
          supplierTransactionStatus: current.status,
          orderStatus: order.status,
          applied: false,
          receiptTriggered: false,
          reason: "supplier_terminal_conflict",
        };
      }
    } else {
      supplierUpdated = true;
    }
  }

  let latestOrder = order;
  let receiptTriggered = false;

  if (incomingStatus === "pending") {
    latestOrder = await updatePendingOrder(order);
  } else {
    latestOrder = await updateTerminalOrder(order, incomingStatus);
    if (latestOrder.status === "success") {
      receiptTriggered = await maybeSendReceipt(order.id);
    }
  }

  try {
    await syncOrderPointsLifecycle(order.id, latestOrder.status);
  } catch (error) {
    console.error(
      `Nambah Points callback sync failed for order ${order.id}`,
      error,
    );
  }

  try {
    await syncOrderCommissionLifecycle(order.id, latestOrder.status);
  } catch (error) {
    console.error(
      `Affiliate commission callback sync failed for order ${order.id}`,
      error,
    );
  }

  try {
    await syncPromotionLifecycle(order.id, latestOrder.status);
  } catch (error) {
    console.error(
      `Promotion callback sync failed for order ${order.id}`,
      error,
    );
  }

  const orderBecameExpected =
    incomingStatus === "pending"
      ? latestOrder.status === "processing"
      : latestOrder.status === incomingStatus;

  if (!orderBecameExpected) {
    const reason =
      latestOrder.status === "pending_payment"
        ? "order_not_paid"
        : latestOrder.status === "success" ||
            latestOrder.status === "failed" ||
            latestOrder.status === "refunded" ||
            latestOrder.status === "cancelled"
          ? "order_terminal"
          : "duplicate";

    return {
      requestRef,
      orderId: order.id,
      callbackStatus,
      supplierStatus: incomingStatus,
      supplierTransactionStatus: incomingStatus,
      orderStatus: latestOrder.status,
      applied: supplierUpdated,
      receiptTriggered,
      reason,
    };
  }

  return {
    requestRef,
    orderId: order.id,
    callbackStatus,
    supplierStatus: incomingStatus,
    supplierTransactionStatus: incomingStatus,
    orderStatus: latestOrder.status,
    applied:
      supplierUpdated ||
      order.status !== latestOrder.status ||
      transaction.status !== incomingStatus,
    receiptTriggered,
    reason:
      transaction.status === incomingStatus &&
      order.status === latestOrder.status
        ? "duplicate"
        : "applied",
  };
}
