import {
  enqueueTelegramMessage,
  escapeTelegramHtml,
  isTelegramConfigured,
} from "@/lib/telegram";
import { supabaseSelect } from "@/lib/supabase/server";
import {
  brandLabel,
  fulfillmentFailedText,
  fulfillmentSuccessText,
  type AlertGameRow,
} from "@/lib/fulfillment-alert-text";

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
  supplier_id: string | null;
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

  /*
   * Tiga lookup paralel: paket, game (brand), dan transaksi supplier.
   *
   * `games` ditambahkan supaya pesan menyebut brand game, bukan cuma
   * nama paket. Untuk order Melostore, `products.label` sering hanya
   * "128 Diamond" - tanpa brand, pesan sukses tidak bisa dibedakan dari
   * order Digiflazz dengan nama paket identik.
   */
  const [products, games, transactions] = await Promise.all([
    supabaseSelect<AlertProductRow>("products", {
      select: "id,label",
      filters: { id: `eq.${order.product_id}` },
      limit: 1,
    }),
    supabaseSelect<AlertGameRow>("games", {
      select: "id,name,short_name",
      filters: { id: `eq.${order.game_id}` },
      limit: 1,
    }),
    supabaseSelect<AlertTransactionRow>("supplier_transactions", {
      select: "supplier_id,message,status,serial_number,supplier_sku",
      filters: { order_id: `eq.${orderId}` },
      order: "created_at.desc",
      limit: 1,
    }),
  ]);

  return {
    order,
    productLabel: products[0]?.label ?? order.product_id,
    brand: brandLabel(games[0], order.game_id),
    transaction: transactions[0] ?? null,
  };
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

  const { order, productLabel, brand, transaction } = context;

  const text = fulfillmentFailedText({
    orderId: order.id,
    brand,
    productLabel,
    transaction,
    sellingPrice: order.selling_price,
    supplierCost: order.supplier_cost,
  });

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
    `Brand game: ${escapeTelegramHtml(context.brand)}`,
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
    `Brand game: ${escapeTelegramHtml(context.brand)}`,
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

  const text = fulfillmentSuccessText({
    orderId: context.order.id,
    brand: context.brand,
    productLabel: context.productLabel,
    serialNumber,
    transaction: context.transaction,
    sellingPrice: context.order.selling_price,
  });

  return enqueueTelegramMessage(text, {
    kind: "fulfillment",
    dedupeKey: `fulfillment-success:${orderId}`,
    payload: { orderId },
  });
}