import { getDigiflazzBalance } from "@/lib/digiflazz/client";
import { formatIDR } from "@/lib/pricing";
import { supabaseInsert, supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";

export type SupplierBalanceStatus = "healthy" | "low" | "critical";
export type SupplierBalanceCheckSource = "manual" | "periodic" | "transaction";

type SupplierBalanceRow = {
  supplier_id: string;
  balance: number | string;
  reserved_balance: number | string;
  checked_at: string;
};

type SupplierBalanceSnapshotRow = {
  status: SupplierBalanceStatus | "unknown";
  checked_at: string;
};

type PricingRuleRow = {
  target_supplier_balance: number | string;
  low_supplier_balance: number | string;
  critical_supplier_balance: number | string;
};

function getStatus(
  availableBalance: number,
  lowThreshold: number,
  criticalThreshold: number,
): SupplierBalanceStatus {
  if (availableBalance <= criticalThreshold) return "critical";
  if (availableBalance <= lowThreshold) return "low";
  return "healthy";
}

function statusLabel(status: SupplierBalanceStatus) {
  return status.toUpperCase();
}

function buildAlertMessage(input: {
  status: SupplierBalanceStatus;
  previousStatus: SupplierBalanceStatus | "unknown" | null;
  balance: number;
  reservedBalance: number;
  availableBalance: number;
  targetBalance: number;
  recommendedDeposit: number;
}) {
  const icon = input.status === "critical" ? "🚨" : input.status === "low" ? "⚠️" : "✅";
  const title =
    input.status === "healthy"
      ? "Saldo Digiflazz kembali aman"
      : input.status === "critical"
        ? "Saldo Digiflazz KRITIS"
        : "Saldo Digiflazz rendah";

  return [
    `${icon} Nambah — ${title}`,
    "",
    `Status: ${statusLabel(input.status)}`,
    input.previousStatus ? `Sebelumnya: ${input.previousStatus.toUpperCase()}` : null,
    `Saldo: ${formatIDR(input.balance)}`,
    `Reserved: ${formatIDR(input.reservedBalance)}`,
    `Tersedia: ${formatIDR(input.availableBalance)}`,
    "",
    `Target: ${formatIDR(input.targetBalance)}`,
    `Saran deposit: ${formatIDR(input.recommendedDeposit)}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export async function checkDigiflazzSupplierBalance(input?: {
  source?: SupplierBalanceCheckSource;
  notify?: boolean;
}) {
  const source = input?.source ?? "manual";
  const notify = input?.notify === true;

  const [currentRows, previousSnapshots, pricingRows, digiflazzBalance] = await Promise.all([
    supabaseSelect<SupplierBalanceRow>("supplier_balances", {
      select: "supplier_id,balance,reserved_balance,checked_at",
      filters: { supplier_id: "eq.digiflazz" },
      limit: 1,
    }),
    supabaseSelect<SupplierBalanceSnapshotRow>("supplier_balance_snapshots", {
      select: "status,checked_at",
      filters: { supplier_id: "eq.digiflazz" },
      order: "checked_at.desc",
      limit: 1,
    }),
    supabaseSelect<PricingRuleRow>("pricing_rules", {
      select: "target_supplier_balance,low_supplier_balance,critical_supplier_balance",
      filters: { id: "eq.default" },
      limit: 1,
    }),
    getDigiflazzBalance(),
  ]);

  const pricingRule = pricingRows[0];
  if (!pricingRule) {
    throw new Error("Pricing rule default belum tersedia untuk balance monitoring.");
  }

  const balance = Math.round(digiflazzBalance);
  const reservedBalance = Math.max(0, Number(currentRows[0]?.reserved_balance ?? 0));
  const availableBalance = Math.max(0, balance - reservedBalance);
  const targetBalance = Number(pricingRule.target_supplier_balance);
  const lowThreshold = Number(pricingRule.low_supplier_balance);
  const criticalThreshold = Number(pricingRule.critical_supplier_balance);
  const status = getStatus(availableBalance, lowThreshold, criticalThreshold);
  const previousStatus = previousSnapshots[0]?.status ?? null;
  const recommendedDeposit = Math.max(0, targetBalance - availableBalance);
  const checkedAt = new Date().toISOString();

  if (currentRows[0]) {
    await supabaseUpdate(
      "supplier_balances",
      {
        balance,
        reserved_balance: reservedBalance,
        checked_at: checkedAt,
        updated_at: checkedAt,
      },
      { filters: { supplier_id: "eq.digiflazz" } },
    );
  } else {
    await supabaseInsert("supplier_balances", {
      supplier_id: "digiflazz",
      balance,
      reserved_balance: reservedBalance,
      checked_at: checkedAt,
      updated_at: checkedAt,
    });
  }

  await supabaseInsert("supplier_balance_snapshots", {
    supplier_id: "digiflazz",
    balance,
    reserved_balance: reservedBalance,
    status,
    source,
    checked_at: checkedAt,
  });

  const statusChanged = previousStatus !== status;
  const shouldNotify =
    notify &&
    statusChanged &&
    (previousStatus !== null || status === "low" || status === "critical");

  let notification:
    | { attempted: false; sent: false; reason: "not-needed" | "not-configured" }
    | { attempted: true; sent: true }
    | { attempted: true; sent: false; reason: "send-failed" };

  if (!shouldNotify) {
    notification = { attempted: false, sent: false, reason: "not-needed" };
  } else if (!isTelegramConfigured()) {
    notification = { attempted: false, sent: false, reason: "not-configured" };
  } else {
    try {
      const result = await sendTelegramMessage(
        buildAlertMessage({
          status,
          previousStatus,
          balance,
          reservedBalance,
          availableBalance,
          targetBalance,
          recommendedDeposit,
        }),
      );
      notification = result.sent
        ? { attempted: true, sent: true }
        : { attempted: false, sent: false, reason: "not-configured" };
    } catch (error) {
      console.error("Telegram supplier balance alert failed", error);
      notification = { attempted: true, sent: false, reason: "send-failed" };
    }
  }

  return {
    supplier: "digiflazz",
    balance,
    reservedBalance,
    availableBalance,
    status,
    previousStatus,
    statusChanged,
    thresholds: {
      target: targetBalance,
      low: lowThreshold,
      critical: criticalThreshold,
    },
    recommendedDeposit,
    checkedAt,
    source,
    notification,
  };
}
