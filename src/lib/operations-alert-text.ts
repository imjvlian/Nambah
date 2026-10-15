import { escapeTelegramHtml } from "@/lib/telegram-format";
import { formatIDR } from "@/lib/pricing";

/**
 * Format pesan operasional untuk Telegram.
 *
 * Modul ini murni: tidak membaca database, tidak mengirim pesan, dan tidak
 * menarik `server-only`. Yang diuji di sini hanya cara incident dan saldo
 * supplier diterjemahkan menjadi teks yang bisa dibaca admin tanpa harus
 * membuka dashboard dulu.
 */

export type OperationsAlertSeverity = "info" | "warning" | "critical";

export type OperationsAlertIncident = {
  severity: OperationsAlertSeverity;
  title: string;
  detail: string;
};

export type OperationsAlertSupplierBalance = {
  supplierLabel: string;
  status: "healthy" | "low" | "critical" | "unknown";
  balance: number;
  reservedBalance: number;
};

const SEVERITY_ORDER: Record<OperationsAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const MAX_INCIDENT_LINES = 5;

function severityIcon(severity: OperationsAlertSeverity) {
  if (severity === "critical") return "🔴";
  if (severity === "warning") return "🟠";
  return "🔵";
}

function statusLabel(status: OperationsAlertSupplierBalance["status"]) {
  if (status === "critical") return "KRITIS";
  if (status === "low") return "RENDAH";
  if (status === "healthy") return "AMAN";
  return "TIDAK DIKETAHUI";
}

export function buildOperationsAlertMessage(input: {
  brandName: string;
  incidents: OperationsAlertIncident[];
  supplierBalances: OperationsAlertSupplierBalance[];
}) {
  const incidents = [...input.incidents].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );
  const highestSeverity = incidents[0]?.severity ?? "info";

  const lines: string[] = [
    `<b>${severityIcon(highestSeverity)} ${escapeTelegramHtml(input.brandName)} Ops — ${incidents.length} hal perlu dicek</b>`,
    "",
  ];

  const visibleIncidents = incidents.slice(0, MAX_INCIDENT_LINES);
  visibleIncidents.forEach((incident, index) => {
    lines.push(`${index + 1}. <b>${escapeTelegramHtml(incident.title)}</b>`);
    lines.push(`   ${escapeTelegramHtml(incident.detail)}`);
  });

  if (incidents.length > MAX_INCIDENT_LINES) {
    lines.push(`   … +${incidents.length - MAX_INCIDENT_LINES} lainnya`);
  }

  if (input.supplierBalances.length > 0) {
    lines.push("", "<b>Saldo supplier:</b>");
    for (const balance of input.supplierBalances) {
      lines.push(
        `   • ${escapeTelegramHtml(balance.supplierLabel)}: ${escapeTelegramHtml(formatIDR(balance.balance))} — ${statusLabel(balance.status)}`,
      );
    }
  }

  lines.push("", "Cek Operations Center untuk detail dan langkah perbaikan.");

  return lines.join("\n");
}
