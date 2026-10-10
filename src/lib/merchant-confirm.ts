import "server-only";

import { supabaseUpdate } from "@/lib/supabase/server";
import {
  getOrderForMerchantScan,
  type MerchantScanOrder,
} from "@/lib/merchant-retail";

/**
 * Konfirmasi order merchant saat kasir memindai kodenya.
 *
 * ALURNYA:
 *
 *   pending_merchant --(kasir scan)--> paid --(fulfillment)--> processing
 *
 * Yang dilakukan modul ini HANYA perpindahan status pertama. Fulfillment
 * dipanggil terpisah, bukan di dalam sini, supaya kegagalan top up tidak
 * membuat merchant mengira pemindaiannya gagal dan memindai ulang.
 *
 * Kenapa harus ada status `paid` di tengah: `fulfillPaidOrder` hanya menerima
 * order berstatus `paid` atau `processing`. Yang penting, scan itu sendiri
 * berarti "merchant sudah menerima uang user" - dan itu perlu terekam
 * terpisah dari "supplier sudah mengirim", karena kalau keduanya jadi satu
 * langkah, order yang gagal di supplier tidak bisa dibedakan dari order yang
 * belum pernah dibayar.
 */

export type MerchantScanRow = {
  id: string;
  merchant_id: string | null;
  status: string;
  final_price: number | string;
  expires_at: string | null;
};

export type ScanResult =
  | {
      ok: true;
      orderId: string;
      /** Nama toko, supaya kasir bisa konfirmasi ke customer. */
      merchantName: string;
      amount: number;
    }
  | {
      ok: false;
      /** HTTP status yang layak dikembalikan ke kasir. */
      status: number;
      /** Pesan yang AMAN dibaca kasir di depan customer. */
      reason: string;
      /**
       * Kode stabil untuk log server-side. Kasir tidak boleh melihat ini -
       * pesan yang berbeda untuk "order sudah discan" vs "kode salah" akan
       * memberi tahu customer kalau ordernya memang ada.
       */
      code:
        | "merchant_disabled"
        | "order_not_found"
        | "wrong_merchant"
        | "already_scanned"
        | "expired"
        | "invalid_state";
    };

/**
 * Status yang masih boleh dipindai.
 *
 * `pending_merchant` satu-satunya. Status lain berarti order sudah diproses
 * oleh jalur lain atau sudah selesai - memindai ulang di situ tidak
 * menghasilkan apa pun dan hanya berisiko mengirim top up dua kali.
 */
const SCANNABLE_STATUS = "pending_merchant";

export async function confirmMerchantScan(
  orderId: string,
  merchantId: string,
): Promise<ScanResult> {
  const order = await getOrderForMerchantScan(orderId);

  if (!order) {
    return {
      ok: false,
      status: 404,
      reason: "Kode tidak ditemukan.",
      code: "order_not_found",
    };
  }

  // Dicentang sebelum status apa pun dibaca. Merchant harus tidak bisa
  // memindai order milik toko lain hanya karena tahu ID-nya.
  if (order.merchant_id !== merchantId) {
    return {
      ok: false,
      status: 403,
      reason: "Kode ini bukan untuk toko Anda.",
      code: "wrong_merchant",
    };
  }

  if (order.status !== SCANNABLE_STATUS) {
    /*
     * "Sudah dipindai" adalah jawaban yang benar DAN kode `already_scanned`.
     * Kasir yang memindai dua kali (kode tertinggal di konter, atau tidak
     * yakin kliknya masuk) harus melihat jawaban yang sama seperti scan
     * pertama - yaitu berhasil. Menolaknya akan membuat kasir memilih
     * memindai ulang terus-menerus, padahal ordernya sudah jalan.
     *
     * Yang tidak boleh terjadi di sini: mengirim ulang ke supplier. Itu
     * urusan `fulfillPaidOrder`, yang sudah idempoten lewat `requestRef`.
     */
    return {
      ok: false,
      status: 409,
      reason:
        order.status === "paid" || order.status === "processing" || order.status === "success"
          ? "Pesanan ini sudah dipindai dan sedang diproses."
          : "Pesanan ini tidak dalam status yang bisa dipindai.",
      code: order.status === "pending_payment" ? "invalid_state" : "already_scanned",
    };
  }

  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    /*
     * Order lewat masa berlaku TIDAK otomatis dibatalkan di sini. Sweeper
     * yang jadi miliknya (`sweepExpiredMerchantOrders`), dengan grace period
     * supaya kasir yang memindai di detik terakhir tidak losesomereservation.
     *
     * Menolak di sini penting: kalau tetap diproses, customer sudah datang
     * ke konter dan sudah bayar, tapi order-nya hangus karena cron belum
     * sempat jalan.
     */
    return {
      ok: false,
      status: 410,
      reason: "Kode ini sudah kedaluwarsa. Minta pelanggan membuat pesanan baru.",
      code: "expired",
    };
  }

  /*
   * Compare-and-swap pada status. Ini yang membuat kode single-use.
   *
   * Dua kasir di toko yang sama bisa menekan tombol bersamaan untuk kode
   * yang sama. Tanpa CAS, keduanya membaca `pending_merchant`, keduanya
   * menulis `paid`, dan fulfillment bisa berjalan dua kali.
   *
   * Filter `status = pending_merchant` membuat hanya satu yang menang.
   * "sudah dipindai" - bukan error, karena order-nya memang sedang jalan.
   */
  const claimed = await supabaseUpdate<{ id: string }>(
    "orders",
    {
      status: "paid",
      status_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      filters: {
        id: `eq.${orderId}`,
        status: `eq.${SCANNABLE_STATUS}`,
      },
    },
  );

  if (claimed.length === 0) {
    return {
      ok: false,
      status: 409,
      reason: "Pesanan ini sudah dipindai dan sedang diproses.",
      code: "already_scanned",
    };
  }

  return {
    ok: true,
    orderId,
    merchantName: order.merchant_name ?? "",
    amount: Number(order.final_price) || 0,
  };
}
