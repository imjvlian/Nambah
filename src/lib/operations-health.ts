import { sendTelegramMessage, isTelegramConfigured } from "@/lib/telegram";
import {
  supabaseSelect,
  supabaseUpsert,
  supabaseUpdate,
} from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";
import { supplierLabel } from "@/lib/fulfillment-alert-text";
import { knownSupplierIds } from "@/lib/suppliers/types";
import { formatIDR } from "@/lib/pricing";
import { buildOperationsAlertMessage } from "@/lib/operations-alert-text";

type Source = "admin" | "cron";
type Severity = "info" | "warning" | "critical";
type Incident = {
  fingerprint: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
};
type IncidentRow = {
  fingerprint: string;
  kind: string;
  severity: Severity;
  status: "open" | "resolved";
  title: string;
  detail: string;
  occurrence_count: number | string;
  first_seen_at: string;
  last_seen_at: string;
  last_notified_at: string | null;
  resolved_at: string | null;
};
type StuckOrderRow = {
  id: string;
  updated_at: string;
  selling_price: number | string;
};
type SupplierTransactionRow = { id: number; updated_at: string };
type ReceiptRow = { id: number; updated_at: string };
type FinanceRow = { order_id: string };
type BalanceRow = {
  supplier_id: string;
  status: "healthy" | "low" | "critical" | "unknown";
  balance: number | string;
  reserved_balance: number | string;
  checked_at: string;
};

const STUCK_MS = 5 * 60_000;
const STALE_RECEIPT_MS = 15 * 60_000;
const SAMPLE_LIMIT = 3;

const NOTIFY_COOLDOWN_MS: Record<Severity, number> = {
  critical: 60 * 60_000,
  warning: 6 * 60 * 60_000,
  info: 24 * 60 * 60_000,
};

function isoBefore(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

function notificationDue(severity: Severity, lastNotifiedAt: string | null) {
  if (!lastNotifiedAt) return true;
  const parsed = Date.parse(lastNotifiedAt);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed >= NOTIFY_COOLDOWN_MS[severity];
}

function sampleIds(rows: Array<{ id: string | number }>) {
  return rows
    .slice(0, SAMPLE_LIMIT)
    .map((row) => `#${row.id}`)
    .join(", ");
}

function sampleOrderIds(rows: Array<{ order_id: string }>) {
  return rows
    .slice(0, SAMPLE_LIMIT)
    .map((row) => `#${row.order_id}`)
    .join(", ");
}

function availableBalance(balance: number, reservedBalance: number) {
  return Math.max(0, balance - reservedBalance);
}

export async function getOperationsHealth(input?: { source?: Source }) {
  const source = input?.source ?? "admin";
  const supplierIds = knownSupplierIds();

  const [
    stuckOrders,
    pendingSupplier,
    failedReceipts,
    staleReceipts,
    financeErrors,
    balanceRows,
    existing,
  ] = await Promise.all([
    supabaseSelect<StuckOrderRow>("orders", {
      select: "id,updated_at,selling_price",
      filters: {
        status: "in.(paid,processing)",
        updated_at: `lt.${isoBefore(STUCK_MS)}`,
      },
      limit: 100,
    }),
    supabaseSelect<SupplierTransactionRow>("supplier_transactions", {
      select: "id,updated_at",
      filters: {
        status: "eq.pending",
        updated_at: `lt.${isoBefore(STUCK_MS)}`,
      },
      limit: 100,
    }),
    supabaseSelect<ReceiptRow>("receipt_deliveries", {
      select: "id,updated_at",
      filters: { status: "eq.failed" },
      limit: 100,
    }),
    supabaseSelect<ReceiptRow>("receipt_deliveries", {
      select: "id,updated_at",
      filters: {
        status: "eq.sending",
        updated_at: `lt.${isoBefore(STALE_RECEIPT_MS)}`,
      },
      limit: 100,
    }),
    supabaseSelect<FinanceRow>("financial_reconciliations", {
      select: "order_id",
      filters: {
        result: "eq.error",
        checked_at: `gt.${isoBefore(24 * 60 * 60_000)}`,
      },
      limit: 100,
    }),
    supabaseSelect<BalanceRow>("supplier_balance_snapshots", {
      select: "supplier_id,status,balance,reserved_balance,checked_at",
      filters: { supplier_id: "in.(" + supplierIds.join(",") + ")" },
      order: "checked_at.desc",
      limit: 100,
    }),
    supabaseSelect<IncidentRow>("operational_incidents", {
      select:
        "fingerprint,kind,severity,status,title,detail,occurrence_count,first_seen_at,last_seen_at,last_notified_at,resolved_at",
      filters: { status: "eq.open" },
      order: "last_seen_at.desc",
      limit: 100,
    }),
  ]);

  const incidents: Incident[] = [];

  if (stuckOrders.length > 0) {
    const totalValue = stuckOrders.reduce(
      (sum, order) => sum + Number(order.selling_price || 0),
      0,
    );
    incidents.push({
      fingerprint: "orders:stuck",
      kind: "orders",
      severity: stuckOrders.length >= 5 ? "critical" : "warning",
      title: "Order masih belum selesai",
      detail: `${stuckOrders.length} order paid/processing sudah lebih dari 5 menit. Contoh: ${sampleIds(stuckOrders)}. Total nilai: ${formatIDR(totalValue)}.`,
      count: stuckOrders.length,
    });
  }

  if (pendingSupplier.length > 0) {
    incidents.push({
      fingerprint: "supplier:pending",
      kind: "supplier",
      severity: pendingSupplier.length >= 5 ? "critical" : "warning",
      title: "Supplier masih memproses transaksi",
      detail: `${pendingSupplier.length} transaksi supplier pending lebih dari 5 menit. Contoh: ${sampleIds(pendingSupplier)}.`,
      count: pendingSupplier.length,
    });
  }

  if (failedReceipts.length > 0 || staleReceipts.length > 0) {
    const receiptSamples = [...failedReceipts, ...staleReceipts];
    incidents.push({
      fingerprint: "receipts:delivery",
      kind: "receipt",
      severity:
        failedReceipts.length > 0 || staleReceipts.length >= 5
          ? "critical"
          : "warning",
      title: "Receipt belum terkirim",
      detail: `${failedReceipts.length} gagal, ${staleReceipts.length} masih mengirim lebih dari 15 menit. Contoh: ${sampleIds(receiptSamples)}.`,
      count: failedReceipts.length + staleReceipts.length,
    });
  }

  if (financeErrors.length > 0) {
    incidents.push({
      fingerprint: "finance:mismatch",
      kind: "finance",
      severity: "critical",
      title: "Selisih pencatatan keuangan",
      detail: `${financeErrors.length} rekonsiliasi keuangan gagal dalam 24 jam terakhir. Contoh: ${sampleOrderIds(financeErrors)}.`,
      count: financeErrors.length,
    });
  }

  /*
   * Saldo supplier dibaca untuk SEMUA supplier yang dikenal, bukan hanya
   * Digiflazz. Melostore harus ikut, karena order yang hanya dijual lewat
   * Melostore akan gagal kalau saldonya habis.
   */
  const latestBalances = new Map<string, BalanceRow>();
  for (const row of balanceRows) {
    if (!latestBalances.has(row.supplier_id)) {
      latestBalances.set(row.supplier_id, row);
    }
  }

  const supplierBalances = supplierIds.flatMap((supplierId) => {
    const row = latestBalances.get(supplierId);
    if (!row) return [];
    return [
      {
        supplierLabel: supplierLabel(supplierId),
        status: row.status,
        balance: Number(row.balance),
        reservedBalance: Number(row.reserved_balance),
      },
    ];
  });

  for (const supplierId of supplierIds) {
    const row = latestBalances.get(supplierId);
    if (!row || (row.status !== "low" && row.status !== "critical")) continue;

    const label = supplierLabel(supplierId);
    const balance = Number(row.balance);
    const reservedBalance = Number(row.reserved_balance);
    const available = availableBalance(balance, reservedBalance);

    incidents.push({
      fingerprint: `supplier:balance:${supplierId}`,
      kind: "supplier_balance",
      severity: row.status === "critical" ? "critical" : "warning",
      title: `Saldo ${label} ${row.status === "critical" ? "kritis" : "rendah"}`,
      detail: `Saldo ${formatIDR(balance)} — tersedia ${formatIDR(available)}, reserved ${formatIDR(reservedBalance)}.`,
      count: 1,
    });
  }

  const now = new Date().toISOString();
  const existingMap = new Map(existing.map((row) => [row.fingerprint, row]));

  for (const item of incidents) {
    const previous = existingMap.get(item.fingerprint);
    await supabaseUpsert(
      "operational_incidents",
      {
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
      },
      { onConflict: "fingerprint" },
    );
  }

  const dueIncidents = incidents.filter((item) =>
    notificationDue(
      item.severity,
      existingMap.get(item.fingerprint)?.last_notified_at ?? null,
    ),
  );

  if (source === "cron" && dueIncidents.length > 0 && isTelegramConfigured()) {
    const message = buildOperationsAlertMessage({
      brandName: BRAND.name,
      incidents,
      supplierBalances,
    });

    try {
      await sendTelegramMessage(message, {
        kind: "ops",
        parseMode: "HTML",
        // Satu pesan per run, bukan satu pesan per incident.
        dedupeKey: `ops:${now.slice(0, 13)}`,
      });

      for (const item of incidents) {
        await supabaseUpdate(
          "operational_incidents",
          {
            last_notified_at: now,
            updated_at: now,
          },
          { filters: { fingerprint: `eq.${item.fingerprint}` } },
        );
      }
    } catch (error) {
      console.error("Operations Telegram alert failed", error);
    }
  }

  const current = new Set(incidents.map((item) => item.fingerprint));
  for (const row of existing) {
    if (!current.has(row.fingerprint)) {
      await supabaseUpdate(
        "operational_incidents",
        {
          status: "resolved",
          resolved_at: now,
          updated_at: now,
        },
        {
          filters: { fingerprint: `eq.${row.fingerprint}`, status: "eq.open" },
        },
      );
    }
  }

  const critical = incidents.filter(
    (item) => item.severity === "critical",
  ).length;
  const warning = incidents.filter(
    (item) => item.severity === "warning",
  ).length;

  return {
    checkedAt: now,
    status: critical > 0 ? "critical" : warning > 0 ? "warning" : "healthy",
    counts: {
      stuckOrders: stuckOrders.length,
      pendingSupplier: pendingSupplier.length,
      failedReceipts: failedReceipts.length,
      staleReceipts: staleReceipts.length,
      financeErrors: financeErrors.length,
    },
    supplierBalances,
    incidents,
  };
}
