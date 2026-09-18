import { sendTelegramMessage, isTelegramConfigured } from "@/lib/telegram";
import { supabaseSelect, supabaseUpsert, supabaseUpdate } from "@/lib/supabase/server";

type Source = "admin" | "cron";
type Severity = "info" | "warning" | "critical";
type Incident = { fingerprint: string; kind: string; severity: Severity; title: string; detail: string; count: number };
type IncidentRow = {
  fingerprint: string; kind: string; severity: Severity; status: "open" | "resolved";
  title: string; detail: string; occurrence_count: number | string;
  first_seen_at: string; last_seen_at: string; last_notified_at: string | null; resolved_at: string | null;
};
type IdRow = { id: string };
type SupplierTransactionRow = { id: number };
type ReceiptRow = { id: number };
type FinanceRow = { order_id: string };
type BalanceRow = {
  status: "healthy" | "low" | "critical" | "unknown";
  balance: number | string; reserved_balance: number | string; checked_at: string;
};

const STUCK_MS = 5 * 60_000;
const STALE_RECEIPT_MS = 15 * 60_000;
const NOTIFY_COOLDOWN_MS = 60 * 60_000;

function isoBefore(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

function notificationDue(value: string | null) {
  if (!value) return true;
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || Date.now() - parsed >= NOTIFY_COOLDOWN_MS;
}

export async function getOperationsHealth(input?: { source?: Source }) {
  const source = input?.source ?? "admin";
  const [stuckOrders, pendingSupplier, failedReceipts, staleReceipts, financeErrors, balances, existing] =
    await Promise.all([
      supabaseSelect<IdRow>("orders", {
        select: "id",
        filters: { status: "in.(paid,processing)", updated_at: `lt.${isoBefore(STUCK_MS)}` },
        limit: 100,
      }),
      supabaseSelect<SupplierTransactionRow>("supplier_transactions", {
        select: "id",
        filters: { status: "eq.pending", updated_at: `lt.${isoBefore(STUCK_MS)}` },
        limit: 100,
      }),
      supabaseSelect<ReceiptRow>("receipt_deliveries", {
        select: "id", filters: { status: "eq.failed" }, limit: 100,
      }),
      supabaseSelect<ReceiptRow>("receipt_deliveries", {
        select: "id",
        filters: { status: "eq.sending", updated_at: `lt.${isoBefore(STALE_RECEIPT_MS)}` },
        limit: 100,
      }),
      supabaseSelect<FinanceRow>("financial_reconciliations", {
        select: "order_id",
        filters: { result: "eq.error", checked_at: `gt.${isoBefore(24 * 60 * 60_000)}` },
        limit: 100,
      }),
      supabaseSelect<BalanceRow>("supplier_balance_snapshots", {
        select: "status,balance,reserved_balance,checked_at",
        filters: { supplier_id: "eq.digiflazz" },
        order: "checked_at.desc",
        limit: 1,
      }),
      supabaseSelect<IncidentRow>("operational_incidents", {
        select: "fingerprint,kind,severity,status,title,detail,occurrence_count,first_seen_at,last_seen_at,last_notified_at,resolved_at",
        filters: { status: "eq.open" },
        order: "last_seen_at.desc",
        limit: 100,
      }),
    ]);

  const incidents: Incident[] = [];
  if (stuckOrders.length) incidents.push({
    fingerprint: "orders:stuck", kind: "orders",
    severity: stuckOrders.length >= 5 ? "critical" : "warning",
    title: "Order membutuhkan recovery",
    detail: `${stuckOrders.length} order paid/processing lebih dari 5 menit.`,
    count: stuckOrders.length,
  });
  if (pendingSupplier.length) incidents.push({
    fingerprint: "supplier:pending", kind: "supplier",
    severity: pendingSupplier.length >= 5 ? "critical" : "warning",
    title: "Supplier transaction pending",
    detail: `${pendingSupplier.length} supplier transaction pending lebih dari 5 menit.`,
    count: pendingSupplier.length,
  });
  if (failedReceipts.length || staleReceipts.length) incidents.push({
    fingerprint: "receipts:delivery", kind: "receipt", severity: "warning",
    title: "Receipt delivery perlu review",
    detail: `${failedReceipts.length} failed, ${staleReceipts.length} stale sending.`,
    count: failedReceipts.length + staleReceipts.length,
  });
  if (financeErrors.length) incidents.push({
    fingerprint: "finance:mismatch", kind: "finance", severity: "critical",
    title: "Financial reconciliation mismatch",
    detail: `${financeErrors.length} error ditemukan dalam 24 jam terakhir.`,
    count: financeErrors.length,
  });

  const latestBalance = balances[0] ?? null;
  if (latestBalance?.status === "low" || latestBalance?.status === "critical") {
    incidents.push({
      fingerprint: "supplier:balance", kind: "supplier_balance",
      severity: latestBalance.status === "critical" ? "critical" : "warning",
      title: latestBalance.status === "critical" ? "Saldo supplier kritis" : "Saldo supplier rendah",
      detail: `Saldo Digiflazz snapshot: ${Number(latestBalance.balance).toLocaleString("id-ID")}.`,
      count: 1,
    });
  }

  const now = new Date().toISOString();
  const existingMap = new Map(existing.map((row) => [row.fingerprint, row]));

  for (const item of incidents) {
    const previous = existingMap.get(item.fingerprint);
    await supabaseUpsert("operational_incidents", {
      fingerprint: item.fingerprint,
      kind: item.kind,
      severity: item.severity,
      status: "open",
      title: item.title,
      detail: item.detail,
      occurrence_count: Number(previous?.occurrence_count ?? 0) + 1,
      first_seen_at: previous?.first_seen_at ?? now,
      last_seen_at: now,
      resolved_at: null,
      metadata: { count: item.count, source },
      updated_at: now,
    }, { onConflict: "fingerprint" });

    if (source === "cron" && item.severity === "critical" && isTelegramConfigured() &&
        notificationDue(previous?.last_notified_at ?? null)) {
      try {
        await sendTelegramMessage(["Nambah Operations", item.title, item.detail].join("\n"));
        await supabaseUpdate("operational_incidents", {
          last_notified_at: now, updated_at: now,
        }, { filters: { fingerprint: `eq.${item.fingerprint}` } });
      } catch (error) {
        console.error("Operations Telegram alert failed", error);
      }
    }
  }

  const current = new Set(incidents.map((item) => item.fingerprint));
  for (const row of existing) {
    if (!current.has(row.fingerprint)) {
      await supabaseUpdate("operational_incidents", {
        status: "resolved", resolved_at: now, updated_at: now,
      }, { filters: { fingerprint: `eq.${row.fingerprint}`, status: "eq.open" } });
    }
  }

  const critical = incidents.filter((item) => item.severity === "critical").length;
  const warning = incidents.filter((item) => item.severity === "warning").length;

  return {
    checkedAt: now,
    status: critical ? "critical" : warning ? "warning" : "healthy",
    counts: {
      stuckOrders: stuckOrders.length,
      pendingSupplier: pendingSupplier.length,
      failedReceipts: failedReceipts.length,
      staleReceipts: staleReceipts.length,
      financeErrors: financeErrors.length,
    },
    supplierBalance: latestBalance ? {
      status: latestBalance.status,
      balance: Number(latestBalance.balance),
      reservedBalance: Number(latestBalance.reserved_balance),
      checkedAt: latestBalance.checked_at,
    } : null,
    incidents,
  };
}
