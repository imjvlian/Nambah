import { getOperationsHealth } from "@/lib/operations-health";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  escapeTelegramHtml,
  parseOrderId,
  telegramHelpText,
} from "@/lib/telegram-format";
import { supabaseSelect } from "@/lib/supabase/server";

/**
 * Perintah bot Telegram yang dipanggil dari webhook.
 *
 * Prinsipnya: hanya membaca, kecuali `/retry-receipt` yang memakai helper
 * resmi `receipt-service` supaya tidak ada jalur pengiriman receipt kedua
 * yang bisa bentrok dengan yang sedang jalan.
 *
 * Setiap jawaban dibungkus try/catch di level pemanggil dan selalu dibalas ke
 * chat asal — Telegram mengulang update yang tidak dijawab dalam 24 jam.
 */

export type BotCommandResult = {
  /** Balasan untuk chat asal. */
  text: string;
  /**>true kalau perintahnya menulis ke database (bukan read-only). */
  mutating?: boolean;
};

type OrderRow = {
  id: string;
  status: string;
  final_price: number | string;
  selling_price: number | string;
  supplier_cost: number | string;
  nambah_profit: number | string;
  created_at: string;
  terminal_at: string | null;
};

type SupplierTxRow = {
  status: string;
  message: string | null;
  serial_number: string | null;
  updated_at: string;
};

type ReceiptRow = {
  channel: string;
  status: string;
  last_error: string | null;
};

type BalanceRow = {
  status: string;
  balance: number | string;
  reserved_balance: number | string;
  checked_at: string;
};

type IncidentRow = {
  fingerprint: string;
  severity: string;
  status: string;
  title: string;
  detail: string;
  occurrence_count: number | string;
  last_seen_at: string;
};

function rupiah(value: number | string) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatTimestamp(value: string | null) {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(parsed));
}

export async function runBotCommand(input: {
  command: string;
  argument: string;
  chatId: string;
}): Promise<BotCommandResult> {
  switch (input.command) {
    case "/start":
    case "/help":
      return { text: telegramHelpText() };

    case "/ping":
      return { text: `Pong. ${formatTimestamp(new Date().toISOString())}` };

    case "/status":
      return { text: await statusText() };

    case "/saldo":
      return { text: await balanceText() };

    case "/order":
      return { text: await orderText(input.argument) };

    case "/incident":
      return { text: await incidentText() };

    case "/retry-receipt":
      return { text: await retryReceiptText(input.argument, input.chatId) };

    default:
      return {
        text: `Perintah ${escapeTelegramHtml(input.command)} tidak dikenal.\n\n${telegramHelpText()}`,
      };
  }
}

async function statusText() {
  const health = await getOperationsHealth({ source: "admin" });

  const lines = [
    `<b>Status operasi</b>: ${escapeTelegramHtml(health.status)}`,
    `Diperiksa: ${formatTimestamp(health.checkedAt)}`,
    "",
    `Order nyangkut: ${health.counts.stuckOrders}`,
    `Supplier pending: ${health.counts.pendingSupplier}`,
    `Receipt gagal: ${health.counts.failedReceipts}`,
    `Receipt stale: ${health.counts.staleReceipts}`,
    `Galat keuangan 24 jam: ${health.counts.financeErrors}`,
  ];

  if (health.supplierBalance) {
    lines.push(
      `Saldo: ${escapeTelegramHtml(rupiah(health.supplierBalance.balance))} (${escapeTelegramHtml(health.supplierBalance.status)})`,
    );
  }

  if (health.incidents.length > 0) {
    lines.push("");
    lines.push(`Incident (${health.incidents.length}):`);
    for (const incident of health.incidents.slice(0, 5)) {
      lines.push(
        `  [${escapeTelegramHtml(incident.severity)}] ${escapeTelegramHtml(incident.title)} — ${escapeTelegramHtml(incident.detail)}`,
      );
    }
  }

  return lines.join("\n");
}

async function balanceText() {
  const snapshots = await supabaseSelect<BalanceRow>("supplier_balance_snapshots", {
    select: "status,balance,reserved_balance,checked_at",
    filters: { supplier_id: "eq.digiflazz" },
    order: "checked_at.desc",
    limit: 1,
  });

  const snapshot = snapshots[0];
  if (!snapshot) return "Belum ada snapshot saldo Digiflazz. Jalankan /api/cron/digiflazz-balance.";

  return [
    `<b>Saldo Digiflazz</b>`,
    `Status: ${escapeTelegramHtml(snapshot.status)}`,
    `Saldo: ${escapeTelegramHtml(rupiah(snapshot.balance))}`,
    `Reservasi: ${escapeTelegramHtml(rupiah(snapshot.reserved_balance))}`,
    `Tersedia: ${escapeTelegramHtml(rupiah(Number(snapshot.balance) - Number(snapshot.reserved_balance)))}`,
    `Diperiksa: ${formatTimestamp(snapshot.checked_at)}`,
  ].join("\n");
}

async function orderText(argument: string) {
  const orderId = parseOrderId(argument);
  if (!orderId) return "Format order id salah. Contoh: /order NBH-20261008-XXXX";

  const orders = await supabaseSelect<OrderRow>("orders", {
    select:
      "id,status,final_price,selling_price,supplier_cost,nambah_profit,created_at,terminal_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  const order = orders[0];
  if (!order) return `Order ${escapeTelegramHtml(orderId)} tidak ditemukan.`;

  const [transactions, receipts] = await Promise.all([
    supabaseSelect<SupplierTxRow>("supplier_transactions", {
      select: "status,message,serial_number,updated_at",
      filters: { order_id: `eq.${orderId}` },
      order: "created_at.desc",
      limit: 1,
    }),
    supabaseSelect<ReceiptRow>("receipt_deliveries", {
      select: "channel,status,last_error",
      filters: { order_id: `eq.${orderId}` },
      order: "created_at.desc",
      limit: 3,
    }),
  ]);

  const lines = [
    `<b>Order ${escapeTelegramHtml(order.id)}</b>`,
    `Status: ${escapeTelegramHtml(order.status)}`,
    `Dibuat: ${formatTimestamp(order.created_at)}`,
    `Selesai: ${formatTimestamp(order.terminal_at)}`,
    `Harga jual: ${escapeTelegramHtml(rupiah(order.selling_price))}`,
    `Total dibayar: ${escapeTelegramHtml(rupiah(order.final_price))}`,
    `Modal: ${escapeTelegramHtml(rupiah(order.supplier_cost))}`,
    `Profit: ${escapeTelegramHtml(rupiah(order.nambah_profit))}`,
  ];

  const transaction = transactions?.[0];
  if (transaction) {
    lines.push("");
    lines.push(`Supplier: ${escapeTelegramHtml(transaction.status)}`);
    if (transaction.serial_number) {
      lines.push(`SN: <code>${escapeTelegramHtml(transaction.serial_number)}</code>`);
    }
    if (transaction.message) {
      lines.push(`Pesan: ${escapeTelegramHtml(transaction.message)}`);
    }
  }

  if (receipts.length > 0) {
    lines.push("");
    lines.push("Receipt:");
    for (const receipt of receipts) {
      lines.push(
        `  ${escapeTelegramHtml(receipt.channel)} — ${escapeTelegramHtml(receipt.status)}${
          receipt.last_error
            ? ` (${escapeTelegramHtml(receipt.last_error.slice(0, 120))})`
            : ""
        }`,
      );
    }
  }

  return lines.join("\n");
}

async function incidentText() {
  const incidents = await supabaseSelect<IncidentRow>("operational_incidents", {
    select: "fingerprint,severity,status,title,detail,occurrence_count,last_seen_at",
    filters: { status: "eq.open" },
    order: "last_seen_at.desc",
    limit: 20,
  });

  if (incidents.length === 0) return "Tidak ada incident terbuka.";

  const lines = [`<b>Incident terbuka (${incidents.length})</b>`];
  for (const incident of incidents) {
    lines.push("");
    lines.push(
      `[${escapeTelegramHtml(incident.severity)}] ${escapeTelegramHtml(incident.title)}`,
    );
    lines.push(escapeTelegramHtml(incident.detail));
    lines.push(
      `  ${escapeTelegramHtml(incident.fingerprint)} · ${Number(incident.occurrence_count ?? 0)}× · terakhir ${formatTimestamp(incident.last_seen_at)}`,
    );
  }

  return lines.join("\n");
}

/**
 * Kirim ulang receipt.
 *
 * Memakai `deliverSuccessReceipt` supaya jalur ini sama dengan scheduler — bukan
 * Versi kedua yang bisa mengirim receipt ganda.
 */
async function retryReceiptText(argument: string, chatId: string) {
  const orderId = parseOrderId(argument);
  if (!orderId) return "Format order id salah. Contoh: /retry-receipt NBH-20261008-XXXX";

  const { deliverSuccessReceipt } = await import("@/lib/receipt-service");
  const result = await deliverSuccessReceipt(orderId);

  await sendTelegramMessage(
    `Retry receipt ${escapeTelegramHtml(orderId)} dijalankan dari chat ${escapeTelegramHtml(chatId)}: hasil <code>${escapeTelegramHtml(result.status)}</code>.`,
    { kind: "command" },
  );

  const labels: Record<string, string> = {
    sent: "receipt berhasil dikirim ulang.",
    sending: "pengiriman sudah berjalan.",
    failed: "gagal — cek log Brevo.",
    disabled: "Brevo receipt dinonaktifkan.",
    not_configured: "BREVO belum dikonfigurasi.",
    not_ready: "order belum sukses atau data receipt belum ada.",
    missing_recipient: "order tidak punya email/kontak tujuan.",
  };

  return `Retry receipt ${escapeTelegramHtml(orderId)}: ${escapeTelegramHtml(labels[result.status] ?? result.status)}`;
}