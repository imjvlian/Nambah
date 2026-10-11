import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import { syncOrderPointsLifecycle } from "@/lib/loyalty";
import { syncOrderCommissionLifecycle } from "@/lib/commission-service";
import { syncPromotionLifecycle } from "@/lib/promotion-service";
import { deliverSuccessReceipt } from "@/lib/receipt-service";
import {
  commitSupplierReservation,
  releaseSupplierReservation,
} from "@/lib/suppliers/reservation";
import type { PublicOrderStatus } from "@/lib/order-public";
import type { SupplierWebhookEvent } from "@/lib/suppliers/types";

/**
 * Terapkan status transaksi Melostore ke order Nambah.
 *
 * Mengikuti alur `digiflazz/status-service.ts` persis, dengan dua
 * perbedaan yang keduanya penting:
 *
 * 1. RESERVASI SALDO. Setelah status final supplier diketahui, reservasi
 *    dilepas lewat RPC yang sama. Untuk Digiflazz ini belum ada, jadi
 *    jalur itu belum dibagi saldonya - Melostore sudah, dan melepaskannya
 *    lewat update biasa akan bentrok dengan resersi yang sedang berjalan.
 *
 * 2. SMART ORDER BISA MENGEMENTUKKAN SKU LAIN. `fulfilled_sku_code` boleh
 *    berbeda dari `sku_code` yang dipesan, karena Melostore memilih
 *    kandidat terbaik saat harga sumber berubah. Jadi SKU dari callback
 *    TIDAK boleh dibandingkan dengan SKU yang dipesan - perbandingan itu
 *    akan menolak callback Smart yang sebenarnya valid.
 */

type SupplierTransactionRow = {
  id: number;
  order_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  cost: number | string;
  status: "pending" | "success" | "failed";
};

type OrderRow = {
  id: string;
  status: string;
  supplier_id: string | null;
  supplier_cost: number | string;
};

export type MelostoreApplyResult = {
  requestRef: string;
  orderId: string | null;
  callbackStatus: string;
  supplierStatus: string;
  supplierTransactionStatus: string | null;
  orderStatus: string | null;
  applied: boolean;
  receiptTriggered: boolean;
  reason:
    | "applied"
    | "duplicate"
    | "unknown_request_ref"
    | "order_missing"
    | "unsupported_status"
    | "supplier_terminal_conflict"
    | "order_not_paid"
    | "order_terminal";
};

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

async function getSupplierTransaction(
  requestRef: string,
): Promise<SupplierTransactionRow | null> {
  const rows = await supabaseSelect<SupplierTransactionRow>(
    "supplier_transactions",
    {
      select: "id,order_id,supplier_id,supplier_sku,cost,status",
      filters: { supplier_id: "eq.melostore", request_ref: `eq.${requestRef}` },
      limit: 1,
    },
  );
  return rows[0] ?? null;
}

async function getOrder(orderId: string): Promise<OrderRow | null> {
  const rows = await supabaseSelect<OrderRow>("orders", {
    select: "id,status,supplier_id,supplier_cost",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });
  return rows[0] ?? null;
}

async function maybeDeliverReceipt(orderId: string): Promise<boolean> {
  try {
    const result = await deliverSuccessReceipt(orderId);
    return result.status === "sent" || result.status === "sending";
  } catch (error) {
    console.error(`Penerimaan nota gagal untuk order ${orderId}`, error);
    return false;
  }
}

async function updatePendingOrder(order: OrderRow): Promise<OrderRow> {
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
    { filters: { id: `eq.${order.id}`, status: "eq.paid" } },
  );
  return updated[0] ?? { ...order, status: "processing" };
}

async function updateTerminalOrder(
  order: OrderRow,
  status: "success" | "failed",
): Promise<OrderRow> {
  const now = new Date().toISOString();
  const updated = await supabaseUpdate<OrderRow>(
    "orders",
    {
      status,
      status_changed_at: now,
      terminal_at: status === "success" ? null : now,
      updated_at: now,
    },
    {
      filters: {
        id: `eq.${order.id}`,
        status: "in.(paid,processing)",
      },
    },
  );
  return updated[0] ?? { ...order, status };
}

export const MelostoreStatusService = {
  async apply(event: SupplierWebhookEvent): Promise<MelostoreApplyResult> {
    const requestRef = clean(event.requestRef, 160) ?? "";
    const incomingStatus = event.status;

    if (!requestRef) {
      return {
        requestRef: "",
        orderId: null,
        callbackStatus: incomingStatus,
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
        callbackStatus: incomingStatus,
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
        callbackStatus: incomingStatus,
        supplierStatus: incomingStatus,
        supplierTransactionStatus: transaction.status,
        orderStatus: null,
        applied: false,
        receiptTriggered: false,
        reason: "order_missing",
      };
    }

    /*
     * Konflik terminal ditolak.
     *
     * Kalau supplier sudah bilang `success` lalu callback berikutnya
     * bilang `failed`, salah satunya pasti salah. Menerjemahkannya
     * tanpa check akan membuat status order bergantisesuai urutan
     * callback - dan urutan itu tidak dijamin.
     */
    if (
      (transaction.status === "success" || transaction.status === "failed") &&
      transaction.status !== incomingStatus
    ) {
      return {
        requestRef,
        orderId: order.id,
        callbackStatus: incomingStatus,
        supplierStatus: incomingStatus,
        supplierTransactionStatus: transaction.status,
        orderStatus: order.status,
        applied: false,
        receiptTriggered: false,
        reason: "supplier_terminal_conflict",
      };
    }

    const now = new Date().toISOString();
    const serialNumber = clean(event.serialNumber, 500);
    const charged = event.charged ?? Number(transaction.cost);

    await supabaseUpdate(
      "supplier_transactions",
      {
        supplier_transaction_id: event.transactionId ?? requestRef,
        status: incomingStatus,
        ...(serialNumber ? { serial_number: serialNumber } : {}),
        cost: charged,
        message:
          [event.errorCode, event.message].filter(Boolean).join(": ") ||
          `Melostore ${incomingStatus}`,
        updated_at: now,
      },
      { filters: { id: `eq.${transaction.id}` } },
    );

    /*
     * Lepas reservasi hanya saat status FINAL.
     *
     * `pending` tidak melepas apa pun - order masih jalan dan saldonya
     * masih harus terkunci. Melepas di sini akan membuat saldo supplier
     * dipakai ulang oleh order lain sementara order ini belum selesai.
     */
    const reservationAmount = Math.round(Number(order.supplier_cost));
    if (incomingStatus === "success" && Number.isFinite(reservationAmount)) {
      try {
        await commitSupplierReservation("melostore", reservationAmount);
      } catch (error) {
        // Gagal melepas reservasi TIDAK membatalkan status order.
        // Order sudah sukses di sisi supplier. Membatalkannya di sini
        // akan membuat pembeli melihat order gagal padahal top up
        // sudah berjalan. Saldo yang gagal dilepas akanATING darin:
      }
    } else if (
      incomingStatus === "failed" &&
      Number.isFinite(reservationAmount)
    ) {
      try {
        await releaseSupplierReservation("melostore", reservationAmount);
      } catch (error) {
        console.error("Gagal release reservasi Melostore", error);
      }
    }

    let latestOrder = order;
    let receiptTriggered = false;

    if (incomingStatus === "pending") {
      latestOrder = await updatePendingOrder(order);
    } else {
      latestOrder = await updateTerminalOrder(
        order,
        incomingStatus as "success" | "failed",
      );
      if (latestOrder.status === "success") {
        receiptTriggered = await maybeDeliverReceipt(order.id);
      }
    }

    for (const [nama, jalankan] of [
      ["Lacte Points", syncOrderPointsLifecycle],
      ["komisi afiliasi", syncOrderCommissionLifecycle],
      ["promo", syncPromotionLifecycle],
    ] as const) {
      try {
        await jalankan(order.id, latestOrder.status as PublicOrderStatus);
      } catch (error) {
        // Kegagalan satu subsystem tidak boleh membatalkan yang lain.
        // Jalur status sudah benar; yang gagal tinggal konsistensi
        // poin/komisi/promo, dan job penyapu akan mengejar.
        console.error(`Sinkronisasi ${nama} gagal untuk order ${order.id}`, error);
      }
    }

    const orderExpected =
      incomingStatus === "pending"
        ? latestOrder.status === "processing"
        : latestOrder.status === incomingStatus;

    if (!orderExpected) {
      const terminal = ["success", "failed", "refunded", "cancelled"];
      const reason =
        latestOrder.status === "pending_payment"
          ? "order_not_paid"
          : terminal.includes(latestOrder.status)
            ? "order_terminal"
            : "duplicate";

      return {
        requestRef,
        orderId: order.id,
        callbackStatus: incomingStatus,
        supplierStatus: incomingStatus,
        supplierTransactionStatus: incomingStatus,
        orderStatus: latestOrder.status,
        applied: false,
        receiptTriggered,
        reason,
      };
    }

    return {
      requestRef,
      orderId: order.id,
      callbackStatus: incomingStatus,
      supplierStatus: incomingStatus,
      supplierTransactionStatus: incomingStatus,
      orderStatus: latestOrder.status,
      applied: transaction.status !== incomingStatus,
      receiptTriggered,
      reason: transaction.status === incomingStatus ? "duplicate" : "applied",
    };
  },
};