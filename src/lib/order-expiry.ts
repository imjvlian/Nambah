import { cancelOrderWithCleanup } from "@/lib/order-cancellation";
import { supabaseSelect } from "@/lib/supabase/server";

/**
 * Sweeper order yang sudah lewat masa pembayaran.
 *
 * SEBELUM file ini ada, `orders.expires_at` ditulis saat insert dan dibaca di
 * query, tapi tidak pernah dipakai untuk membatalkan apa pun — `grep 'is.expired'`
 * = 0 hasil di seluruh codebase. Order `pending_payment` hanya pernah berubah
 * status kalau Midtrans mengirim webhook atau customer menekan tombol refresh.
 *
 * Akibatnya order yang ditinggalkan (customer menutup tab, atau proses mati di
 * tengah pembuatan order) mengunci reservasi SELAMANYA:
 *   - `reserved_points` customer tidak pernah kembali, dan `available` dihitung
 *     sebagai `balance - reserved` (`loyalty.ts`) sehingga saldo tampak menipis
 *     tanpa sebab sampai customerapus riwayat order.
 *   - kuota promo (`promotion_redemptions`) tidak pernah kembali.
 *
 * Index `idx_orders_expires_at ... where status = 'pending_payment'` sudah ada
 * sejak migrasi 006 — infrastrukturnya direncanakan, hanya implementasinya yang
 * tidak pernah ditulis.
 */

/** Jangka waktu pembayaran yang dijanjikan ke customer (lihat `POST /api/orders`). */
export const ORDER_EXPIRY_WINDOW_MS = 30 * 60_000;

/**
 * Toleransi sebelum order dianggap benar-benar kedaluwarsa.
 *
 * `expiry.duration` yang dikirim ke Midtrans juga 30 menit, jadi Midtrans sudah
 * menolak pembayaran lewat batas itu. Grace period ini menutup celah antara
 * `expires_at` dan waktu Midtrans benar-benar menandai `expire`, sekaligus
 * memberi ruang untuk webhook yang telat sampai.
 */
export const ORDER_EXPIRY_GRACE_MS = 5 * 60_000;

export type OrderExpirySweepResult = {
  checked: number;
  cancelled: number;
  /** Sudah tidak `pending_payment` saat swept — dibayar bersamaan dengan cron ini. */
  alreadySettled: number;
  /**
   * Pembayaran sudah tercatat di tabel `payments` tapi baris `orders` belum
   * ikut ter-update. Order ini sengaja TIDAK dibatalkan — lihat catatan race di
   * `sweepExpiredPendingOrders`.
   */
  paymentDetected: number;
  failures: Array<{ orderId: string; message: string }>;
};

type PendingOrderRow = {
  id: string;
};

export async function sweepExpiredPendingOrders(
  limit: number,
): Promise<OrderExpirySweepResult> {
  const result: OrderExpirySweepResult = {
    checked: 0,
    cancelled: 0,
    alreadySettled: 0,
    paymentDetected: 0,
    failures: [],
  };

  const cutoff = new Date(
    Date.now() - ORDER_EXPIRY_GRACE_MS,
  ).toISOString();

  const expired = await supabaseSelect<PendingOrderRow>("orders", {
    select: "id",
    filters: {
      status: "eq.pending_payment",
      expires_at: `lt.${cutoff}`,
    },
    order: "expires_at.asc",
    limit,
  });

  // Order yang dibuat sebelum migrasi timing (006) punya `expires_at` NULL, jadi
  // tidak pernah tertangkap query di atas. Bersihkan juga supaya reservasi dari
  // order lama tidak terkunci selamanya. `expires_at IS NULL` dan
  // `expires_at < cutoff` saling lepas, jadi tidak ada order yang ter proses dua
  // kali — tapi ID-nya tetap dideduplikasi sebagai pengaman.
  const legacy = await supabaseSelect<PendingOrderRow>("orders", {
    select: "id",
    filters: {
      status: "eq.pending_payment",
      expires_at: "is.null",
      created_at: `lt.${cutoff}`,
    },
    order: "created_at.asc",
    limit,
  });

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const order of [...expired, ...legacy]) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    candidates.push(order.id);
  }

  if (candidates.length === 0) return result;

  // Race dengan webhook yang telat.
  //
  // `applyMidtransStatus` menulis baris `payments` (menandai `paid_at`) LEBIH
  // DAHULU daripada baris `orders` (`order-service.ts`). Jadi ada jendela di mana
  // pembayaran sudah tercatat tapi `orders.status` masih `pending_payment` —
  // dan compare-and-swap di `cancelOrderWithCleanup` masih akan cocok, sehingga
  // order yang pembayarannya sah dibatalkan.
  //
  // Meminta `payments` untuk seluruh batch sekaligus (satu query) menutup jendela
  // itu: kalau `paid_at` sudah terisi, pembayaran tidak boleh dibatalkan, dan
  // transisi ke `paid` tetap dilakukan oleh webhook-nya sendiri.
  const settledOrderIds = new Set<string>();
  const settledPayments = await supabaseSelect<{ order_id: string }>("payments", {
    select: "order_id",
    filters: {
      order_id: `in.(${candidates.join(",")})`,
      paid_at: "not.is.null",
    },
    limit: candidates.length,
  });

  for (const payment of settledPayments) {
    settledOrderIds.add(payment.order_id);
  }

  for (const orderId of candidates) {
    result.checked += 1;

    if (settledOrderIds.has(orderId)) {
      result.paymentDetected += 1;
      console.warn(
        `Order ${orderId} lewat masa pembayaran tapi pembayarannya sudah tercatat — dibiarkan untuk diproses webhook`,
      );
      continue;
    }

    try {
      const cancelled = await cancelOrderWithCleanup(orderId, "expired");
      if (cancelled) {
        result.cancelled += 1;
      } else {
        // Compare-and-swap di `cancelOrderWithCleanup` tidak cocok: order sudah
        // tidak `pending_payment`, jadi pembayaran masuk bersamaan dengan cron
        // ini dan reservasinya TIDAK ikut dilepas.
        result.alreadySettled += 1;
      }
    } catch (error) {
      result.failures.push({
        orderId,
        message:
          error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    }
  }

  return result;
}
