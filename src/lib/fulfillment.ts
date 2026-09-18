import {
  runDigiflazzPrepaidTransaction,
  runDigiflazzTestTransaction,
  type DigiflazzTestOutcome,
} from "@/lib/digiflazz/client";
import { renderFulfillmentTarget } from "@/lib/fulfillment-target";
import { isFlowTestMode } from "@/lib/flow-test";
import { syncOrderPointsLifecycle } from "@/lib/loyalty";
import { syncOrderCommissionLifecycle } from "@/lib/commission-service";
import { syncPromotionLifecycle } from "@/lib/promotion-service";
import { deliverSuccessReceipt } from "@/lib/receipt-service";
import type { PublicOrderStatus } from "@/lib/order-public";
import {
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";

export type FulfillmentMode =
  | "disabled"
  | "simulate"
  | "digiflazz-test"
  | "digiflazz-live";

type SimulationOutcome = "success" | "failed" | "pending";

type OrderRow = {
  id: string;
  game_id: string;
  product_id: string;
  supplier_id: string | null;
  target_user_id: string;
  target_server_id: string | null;
  supplier_cost: number | string;
  status: PublicOrderStatus;
};

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
  status: "pending" | "success" | "failed";
  message: string | null;
  serial_number: string | null;
  created_at: string;
  updated_at: string;
};

export type FulfillmentResult = {
  mode: FulfillmentMode;
  orderId: string;
  requestRef: string;
  status: "disabled" | "pending" | "success" | "failed";
  source: "local" | "digiflazz";
};

const FULFILLMENT_MODES = new Set<FulfillmentMode>([
  "disabled",
  "simulate",
  "digiflazz-test",
  "digiflazz-live",
]);

const SIMULATION_OUTCOMES = new Set<SimulationOutcome>([
  "success",
  "failed",
  "pending",
]);

const DIGIFLAZZ_TEST_OUTCOMES = new Set<DigiflazzTestOutcome>([
  "success",
  "failed",
  "pending-success",
  "pending-failed",
]);

function configuredValue(name: string) {
  return process.env[name]?.trim().toLowerCase() ?? "";
}

function explicitlyEnabled(name: string) {
  return ["true", "1", "yes", "on"].includes(configuredValue(name));
}

export function assertLiveFulfillmentSafety() {
  if (!explicitlyEnabled("NAMBAH_ALLOW_LIVE_FULFILLMENT")) {
    throw new Error(
      "Digiflazz live fulfillment dikunci. NAMBAH_ALLOW_LIVE_FULFILLMENT belum aktif.",
    );
  }

  const acknowledgment =
    process.env.NAMBAH_LIVE_FULFILLMENT_ACK?.trim() ?? "";
  if (acknowledgment !== "SPEND_REAL_DIGIFLAZZ_BALANCE") {
    throw new Error(
      "Digiflazz live fulfillment membutuhkan NAMBAH_LIVE_FULFILLMENT_ACK=SPEND_REAL_DIGIFLAZZ_BALANCE.",
    );
  }
}

export function getFulfillmentMode(): FulfillmentMode {
  const configured = configuredValue("NAMBAH_FULFILLMENT_MODE");
  if (!configured) {
    return isFlowTestMode() ? "simulate" : "disabled";
  }

  if (!FULFILLMENT_MODES.has(configured as FulfillmentMode)) {
    throw new Error(
      `NAMBAH_FULFILLMENT_MODE tidak valid: ${configured}. Gunakan disabled, simulate, digiflazz-test, atau digiflazz-live.`,
    );
  }

  return configured as FulfillmentMode;
}

function getSimulationOutcome(): SimulationOutcome {
  const configured = configuredValue("NAMBAH_SIMULATED_FULFILLMENT_OUTCOME") || "success";
  if (!SIMULATION_OUTCOMES.has(configured as SimulationOutcome)) {
    throw new Error(
      `NAMBAH_SIMULATED_FULFILLMENT_OUTCOME tidak valid: ${configured}.`,
    );
  }
  return configured as SimulationOutcome;
}

function getDigiflazzTestOutcome(): DigiflazzTestOutcome {
  const configured = configuredValue("NAMBAH_DIGIFLAZZ_TEST_OUTCOME") || "success";
  if (!DIGIFLAZZ_TEST_OUTCOMES.has(configured as DigiflazzTestOutcome)) {
    throw new Error(
      `NAMBAH_DIGIFLAZZ_TEST_OUTCOME tidak valid: ${configured}.`,
    );
  }
  return configured as DigiflazzTestOutcome;
}

function requestRefForOrder(orderId: string) {
  return `NMB-${orderId}`;
}

function targetForLog(order: OrderRow) {
  return order.target_server_id
    ? `${order.target_user_id}:${order.target_server_id}`
    : order.target_user_id;
}

async function getOrder(orderId: string) {
  const [order] = await supabaseSelect<OrderRow>("orders", {
    select:
      "id,game_id,product_id,supplier_id,target_user_id,target_server_id,supplier_cost,status",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });
  return order ?? null;
}


type LiveDispatchConfig = {
  supplierSku: string;
  customerNo: string;
  allowDot: boolean;
  maxPrice: number;
};

async function getLiveDispatchConfig(
  order: OrderRow,
): Promise<LiveDispatchConfig> {
  assertLiveFulfillmentSafety();

  const [[mapping], [product], [game]] = await Promise.all([
    supabaseSelect<{
      supplier_sku: string | null;
      supplier_cost: number | string;
      active: boolean;
    }>("supplier_products", {
      select: "supplier_sku,supplier_cost,active",
      filters: {
        supplier_id: "eq.digiflazz",
        product_id: `eq.${order.product_id}`,
        active: "eq.true",
      },
      limit: 1,
    }),
    supabaseSelect<{
      game_id: string;
      fulfillment_target_template: string | null;
    }>("products", {
      select: "game_id,fulfillment_target_template",
      filters: { id: `eq.${order.product_id}`, active: "eq.true" },
      limit: 1,
    }),
    supabaseSelect<{
      requires_server: boolean;
      fulfillment_target_template: string | null;
    }>("games", {
      select: "requires_server,fulfillment_target_template",
      filters: { id: `eq.${order.game_id}`, active: "eq.true" },
      limit: 1,
    }),
  ]);

  if (!mapping?.supplier_sku || !mapping.active) {
    throw new Error(
      "SKU Digiflazz live belum mapped atau sedang tidak aktif.",
    );
  }

  const frozenCost = Number(order.supplier_cost);
  const currentCost = Number(mapping.supplier_cost);
  if (!Number.isFinite(frozenCost) || frozenCost <= 0) {
    throw new Error("Supplier cost snapshot order tidak valid.");
  }
  if (!Number.isFinite(currentCost) || currentCost < 0) {
    throw new Error("Supplier cost mapping tidak valid.");
  }
  if (currentCost > frozenCost) {
    throw new Error(
      "Harga supplier naik setelah checkout. Live dispatch diblokir agar margin tidak menjadi negatif.",
    );
  }

  const template =
    product?.fulfillment_target_template?.trim() ||
    game?.fulfillment_target_template?.trim() ||
    "";

  const rendered = renderFulfillmentTarget(template, {
    userId: order.target_user_id,
    serverId: order.target_server_id,
    requiresServer: Boolean(game?.requires_server),
  });

  return {
    supplierSku: mapping.supplier_sku,
    customerNo: rendered.customerNo,
    allowDot: rendered.allowDot,
    maxPrice: frozenCost,
  };
}

async function getSupplierTransaction(requestRef: string) {
  const [transaction] = await supabaseSelect<SupplierTransactionRow>(
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
  return transaction ?? null;
}

async function ensureSupplierTransaction(
  order: OrderRow,
  requestRef: string,
  mode: FulfillmentMode,
  liveConfig?: LiveDispatchConfig,
) {
  const existing = await getSupplierTransaction(requestRef);
  if (existing) return existing;

  const now = new Date().toISOString();
  await supabaseUpsert<SupplierTransactionRow>(
    "supplier_transactions",
    {
      order_id: order.id,
      supplier_id: "digiflazz",
      product_id: order.product_id,
      request_ref: requestRef,
      supplier_transaction_id: null,
      supplier_sku:
        mode === "digiflazz-test"
          ? "xld10"
          : mode === "simulate"
            ? "__simulate__"
            : liveConfig?.supplierSku ?? null,
      target:
        mode === "digiflazz-live"
          ? liveConfig?.customerNo ?? targetForLog(order)
          : targetForLog(order),
      cost:
        mode === "digiflazz-live"
          ? liveConfig?.maxPrice ?? Number(order.supplier_cost)
          : 0,
      status: "pending",
      message: `queued:${mode}`,
      serial_number: null,
      created_at: now,
      updated_at: now,
    },
    {
      onConflict: "supplier_id,request_ref",
      prefer: "resolution=ignore-duplicates,return=representation",
    },
  );

  const transaction = await getSupplierTransaction(requestRef);
  if (!transaction) {
    throw new Error(`Supplier transaction ${requestRef} gagal dibuat.`);
  }
  return transaction;
}

async function markOrderProcessing(order: OrderRow) {
  if (order.status === "processing") return;

  const now = new Date().toISOString();
  await supabaseUpdate(
    "orders",
    {
      status: "processing",
      status_changed_at: now,
      terminal_at: null,
      updated_at: now,
    },
    { filters: { id: `eq.${order.id}` } },
  );
}

async function tryDeliverReceipt(orderId: string) {
  try {
    await deliverSuccessReceipt(orderId);
  } catch (error) {
    // Receipt delivery must never roll back successful fulfillment.
    console.error(`Receipt trigger failed for order ${orderId}`, error);
  }
}

async function finalizeOrder(
  orderId: string,
  status: "success" | "failed",
) {
  const now = new Date().toISOString();
  const updated = await supabaseUpdate<{ id: string; status: PublicOrderStatus }>(
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
        id: `eq.${orderId}`,
        status: "in.(paid,processing)",
      },
    },
  );

  if (updated.length === 0) return;

  try {
    await syncOrderPointsLifecycle(orderId, status);
  } catch (error) {
    console.error(`Nambah Points finalization failed for order ${orderId}`, error);
  }

  try {
    await syncOrderCommissionLifecycle(orderId, status);
  } catch (error) {
    console.error(`Affiliate commission finalization failed for order ${orderId}`, error);
  }

  try {
    await syncPromotionLifecycle(orderId, status);
  } catch (error) {
    console.error(`Promotion finalization failed for order ${orderId}`, error);
  }

  if (status === "success") {
    await tryDeliverReceipt(orderId);
  }
}

async function syncExistingTerminalTransaction(
  order: OrderRow,
  transaction: SupplierTransactionRow,
) {
  if (transaction.status === "success") {
    if (
      order.status === "refunded" ||
      order.status === "cancelled" ||
      order.status === "failed"
    ) {
      return true;
    }
    if (order.status !== "success") {
      await finalizeOrder(order.id, "success");
    } else {
      try {
        await syncOrderPointsLifecycle(order.id, "success");
      } catch (error) {
        console.error(`Nambah Points resync failed for order ${order.id}`, error);
      }
      await tryDeliverReceipt(order.id);
    }
    return true;
  }

  if (transaction.status === "failed") {
    if (
      order.status === "success" ||
      order.status === "refunded" ||
      order.status === "cancelled"
    ) {
      return true;
    }
    if (order.status !== "failed") await finalizeOrder(order.id, "failed");
    return true;
  }

  return false;
}

function normalizeDigiflazzStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "sukses" || normalized === "success") return "success" as const;
  if (normalized === "gagal" || normalized === "failed") return "failed" as const;
  return "pending" as const;
}

async function runSimulation(
  order: OrderRow,
  transaction: SupplierTransactionRow,
  requestRef: string,
): Promise<FulfillmentResult> {
  const outcome = getSimulationOutcome();
  const now = new Date().toISOString();
  const status =
    outcome === "success" ? "success" : outcome === "failed" ? "failed" : "pending";

  await supabaseUpdate(
    "supplier_transactions",
    {
      supplier_transaction_id: `simulate:${requestRef}`,
      supplier_sku: "__simulate__",
      cost: 0,
      status,
      message: `Simulated fulfillment: ${outcome}`,
      updated_at: now,
    },
    { filters: { id: `eq.${transaction.id}` } },
  );

  if (status === "success" || status === "failed") {
    await finalizeOrder(order.id, status);
  }

  return {
    mode: "simulate",
    orderId: order.id,
    requestRef,
    status,
    source: "local",
  };
}

async function runDigiflazzTest(
  order: OrderRow,
  transaction: SupplierTransactionRow,
  requestRef: string,
): Promise<FulfillmentResult> {
  const outcome = getDigiflazzTestOutcome();

  try {
    const result = await runDigiflazzTestTransaction({
      outcome,
      refId: requestRef,
    });
    const status = normalizeDigiflazzStatus(result.status);
    const now = new Date().toISOString();

    await supabaseUpdate(
      "supplier_transactions",
      {
        supplier_transaction_id: result.ref_id || requestRef,
        supplier_sku: result.buyer_sku_code || "xld10",
        // testing:true is deliberately recorded as zero real spend.
        cost: 0,
        status,
        message: `Digiflazz test: ${result.message || result.status}`,
        serial_number: result.sn ?? null,
        updated_at: now,
      },
      { filters: { id: `eq.${transaction.id}` } },
    );

    if (status === "success" || status === "failed") {
      await finalizeOrder(order.id, status);
    }

    return {
      mode: "digiflazz-test",
      orderId: order.id,
      requestRef,
      status,
      source: "digiflazz",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Digiflazz test error.";
    await supabaseUpdate(
      "supplier_transactions",
      {
        message: `dispatch_error:${message}`,
        updated_at: new Date().toISOString(),
      },
      { filters: { id: `eq.${transaction.id}` } },
    );
    throw error;
  }
}


async function runDigiflazzLive(
  order: OrderRow,
  transaction: SupplierTransactionRow,
  requestRef: string,
  config: LiveDispatchConfig,
): Promise<FulfillmentResult> {
  try {
    const result = await runDigiflazzPrepaidTransaction({
      buyerSkuCode: config.supplierSku,
      customerNo: config.customerNo,
      refId: requestRef,
      maxPrice: config.maxPrice,
      testing: false,
      useCallback: true,
      allowDot: config.allowDot,
    });
    const status = normalizeDigiflazzStatus(result.status);
    const now = new Date().toISOString();

    await supabaseUpdate(
      "supplier_transactions",
      {
        supplier_transaction_id: result.ref_id || requestRef,
        supplier_sku: result.buyer_sku_code || config.supplierSku,
        target: config.customerNo,
        cost: Number(result.price ?? config.maxPrice),
        status,
        message: `Digiflazz live: ${result.message || result.status}`,
        serial_number: result.sn ?? null,
        updated_at: now,
      },
      { filters: { id: `eq.${transaction.id}` } },
    );

    if (status === "success" || status === "failed") {
      await finalizeOrder(order.id, status);
    }

    return {
      mode: "digiflazz-live",
      orderId: order.id,
      requestRef,
      status,
      source: "digiflazz",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Digiflazz live error.";
    await supabaseUpdate(
      "supplier_transactions",
      {
        message: `dispatch_error:${message}`,
        updated_at: new Date().toISOString(),
      },
      { filters: { id: `eq.${transaction.id}` } },
    );
    throw error;
  }
}

export async function fulfillPaidOrder(orderId: string): Promise<FulfillmentResult> {
  const order = await getOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} tidak ditemukan untuk fulfillment.`);

  const requestRef = requestRefForOrder(order.id);
  const existing = await getSupplierTransaction(requestRef);

  if (existing && (await syncExistingTerminalTransaction(order, existing))) {
    return {
      mode: getFulfillmentMode(),
      orderId: order.id,
      requestRef,
      status: existing.status,
      source: existing.supplier_transaction_id?.startsWith("simulate:")
        ? "local"
        : "digiflazz",
    };
  }

  if (
    order.status === "success" ||
    order.status === "failed" ||
    order.status === "refunded" ||
    order.status === "cancelled"
  ) {
    if (order.status === "success") {
      await tryDeliverReceipt(order.id);
    }

    return {
      mode: getFulfillmentMode(),
      orderId: order.id,
      requestRef,
      status: order.status === "success" ? "success" : "failed",
      source: "local",
    };
  }

  if (order.status !== "paid" && order.status !== "processing") {
    throw new Error(
      `Order ${order.id} belum siap fulfillment (status: ${order.status}).`,
    );
  }

  if (order.supplier_id !== "digiflazz") {
    throw new Error(
      `Order ${order.id} tidak memiliki supplier Digiflazz yang valid.`,
    );
  }

  const mode = getFulfillmentMode();
  if (mode === "disabled") {
    return {
      mode,
      orderId: order.id,
      requestRef,
      status: "disabled",
      source: "local",
    };
  }

  const liveConfig =
    mode === "digiflazz-live"
      ? await getLiveDispatchConfig(order)
      : undefined;

  const transaction =
    existing ??
    (await ensureSupplierTransaction(order, requestRef, mode, liveConfig));

  if (transaction.supplier_transaction_id) {
    await markOrderProcessing(order);
    return {
      mode,
      orderId: order.id,
      requestRef,
      status: "pending",
      source: transaction.supplier_transaction_id.startsWith("simulate:")
        ? "local"
        : "digiflazz",
    };
  }

  await markOrderProcessing(order);

  if (mode === "simulate") {
    return runSimulation(order, transaction, requestRef);
  }

  if (mode === "digiflazz-live") {
    return runDigiflazzLive(
      order,
      transaction,
      requestRef,
      liveConfig!,
    );
  }

  return runDigiflazzTest(order, transaction, requestRef);
}
