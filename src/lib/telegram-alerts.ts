import {
  enqueueTelegramMessage,
  escapeTelegramHtml,
  isTelegramConfigured,
} from "@/lib/telegram";
import { supabaseSelect } from "@/lib/supabase/server";

/**
 * Alert peristiwa bisnis untuk admin, lewat antrean Telegram.
 *
 * Semua pesan di sini masuk `telegram_delivery_log` dengan status `pending`
 * dan dikirim oleh worker, bukan langsung. Alasannya dua: Telegram membatas
 * ~1 pesan/detik per chat, dan Notifikasi tidak boleh ikut menggagalkan
 * proses fulfilment atau receipt yang sedang berjalan.
 *
 * Isi pesan sengaja tidak memuat `target_user_id`, email, atau WhatsApp.
 * Admin cukup buka dashboard dari order id yang sudah dicantumkan.
 */

type AlertOrderRow = {
  id: string;
  status: string;
  product_id: string;
  game_id: string;
  selling_price: number | string;
  supplier_cost: number | string;
  created_at: string;
};

type AlertProductRow = {
  id: string;
  label: string;
};

type AlertTransactionRow = {
  message: string | null;
  status: string;
  serial_number: string | null;
  supplier_sku: string | null;
};

async function loadOrderContext(orderId: string) {
  const orders = await supabaseSelect<AlertOrderRow>("orders", {
    select: "id,status,product_id,game_id,selling_price,supplier_cost,created_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });
  const order = orders[0];
  if (!order) return null;

  const [products, transactions] = await Promise.all([
    supabaseSelect<AlertProductRow>("products", {
      select: "id,label",
      filters: { id: `eq.${order.product_id}` },
      limit: 1,
    }),
    supabaseSelect<AlertTransactionRow>("supplier_transactions", {
      select: "message,status,serial_number,supplier_sku",
      filters: { order_id: `eq.${orderId}` },
      order: "created_at.desc",
      limit: 1,
    }),
  ]);

  return {
    order,
    productLabel: products[0]?.label ?? order.product_id,
    transaction: transactions[0] ?? null,
  };
}

function rupiah(value: number | string) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/**
 * Fulfillment supplier gagal.
 *
 * Ini event yang paling mahal kalau terlewat: pelanggan sudah membayar tapi
 * barang tidak masuk. Pesan sengaja memuat alasan dari supplier supaya admin
 * tahu ini case refund atau case fulfillment manual.
 */
export async function notifyFulfillmentFailed(orderId: string) {
  if (!isTelegramConfigured()) return { queued: false as const, reason: "not-configured" as const };

  const context = await loadOrderContext(orderId);
  if (!context) return { queued: false as const, reason: "order-not-found" as const };

  const { order, productLabel, transaction } = context;
    const reason = transaction?.message?.trim() || "Tanpa pesan dari supplier.";

  const text = [
    "<b>Fulfillment GAGAL</b>",
    `Order <code>${escapeTelegramHtml(order.id)}</code>`,
    `Produk: ${escapeTelegramHtml(productLabel)}`,
    `Supplier: ${escapeTelegramHtml(transaction?.supplier_sku ?? "-")}`,
    `Alasan: ${escapeTelegramHtml(reason)}`,
    `Dibayar: ${escapeTelegramHtml(rupiah(order.selling_price))}`,
    `Modal: ${escapeTelegramHtml(rupiah(order.supplier_cost))}`,
  ].join("\n");

  return enqueueTelegramMessage(text, {
    kind: "fulfillment",
    dedupeKey: `fulfillment-failed:${order.id}`,
    payload: { orderId: order.id, productId: order.product_id },
  });
}

/**
 * Receipt gagal terkirim. Pelanggan sudah bayar tapi bukti transaksi tidak
 * sampai — biasanya jadi tiket dukungan, jadi perlu tahu segera.
 */
export async function notifyReceiptDeliveryFailed(
  orderId: string,
  channel: string,
  reason: string,
) {
  if (!isTelegramConfigured()) return { queued: false as const, reason: "not-configured" as const };

  const context = await loadOrderContext(orderId);
  if (!context) return { queued: false as const, reason: "order-not-found" as const };

  const text = [
    "<b>Receipt GAGAL terkirim</b>",
    `Order <code>${escapeTelegramHtml(context.order.id)}</code>`,
    `Kanal: ${escapeTelegramHtml(channel)}`,
    `Produk: ${escapeTelegramHtml(context.productLabel)}`,
    `Alasan: ${escapeTelegramHtml(reason.trim() || "Tidak diketahui")}`,
  ].join("\n");

  return enqueueTelegramMessage(text, {
    kind: "receipt",
    dedupeKey: `receipt-failed:${context.order.id}:${channel}`,
    payload: { orderId: context.order.id, channel },
  });
}

/**
 * Order menggantung di `paid`/`processing` terlalu lama.
 *
 * Dipakai juga `operations-health` supaya ambang "nyangkut" bisa diturunkan
 * dari 5 order ke per order tanpa mengubah struktur incident-nya.
 */
export async function notifyOrderStuck(orderId: string, stuckMinutes: number) {
  if (!isTelegramConfigured()) return { queued: false as const, reason: "not-configured" as const };

  const context = await loadOrderContext(orderId);
  if (!context) return { queued: false as const, reason: "order-not-found" as const };

  const text = [
    "<b>Order NYANGKUT</b>",
    `Order <code>${escapeTelegramHtml(context.order.id)}</code>`,
    `Status: ${escapeTelegramHtml(context.order.status)}`,
    `Produk: ${escapeTelegramHtml(context.productLabel)}`,
    `Nyelepet ${stuckMinutes} menit sejak update terakhir.`,
  ].join("\n");

  return enqueueTelegramMessage(text, {
    kind: "ops",
    // Dibatasi per jam supaya polling 10 menit tidak mengirim pesan yang sama
    // berulang selama order itu masih nyangkut.
    dedupeKey: `stuck:${orderId}:${Math.floor(Date.now() / 3_600_000)}`,
    payload: { orderId, stuckMinutes },
  });
}

/**
 * Fulfillment sukses tapi butuh perhatian — dipakai untuk Sending serial
 * number supaya admin punya catatan kalau ada sengketa SN.
 */
export async function notifyFulfillmentSucceeded(
  orderId: string,
  serialNumber: string | null,
) {
  if (!isTelegramConfigured()) return { queued: false as const, reason: "not-configured" as const };
  if (!serialNumber?.trim()) return { queued: false as const, reason: "no-serial-number" as const };

  const context = await loadOrderContext(orderId);
  if (!context) return { queued: false as const, reason: "order-not-found" as const };

  const text = [
    "<b>Fulfillment SUKSES</b>",
    `Order <code>${escapeTelegramHtml(context.order.id)}</code>`,
    `Produk: ${escapeTelegramHtml(context.productLabel)}`,
    `SN: <code>${escapeTelegramHtml(serialNumber.trim())}</code>`,
  ].join("\n");

  return enqueueTelegramMessage(text, {
    kind: "fulfillment",
    dedupeKey: `fulfillment-success:${orderId}`,
    payload: { orderId },
  });
}