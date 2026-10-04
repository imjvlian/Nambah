import { restoreOrderPointsRedemption } from "@/lib/loyalty";
import { syncPromotionLifecycle } from "@/lib/promotion-service";
import { supabaseUpdate } from "@/lib/supabase/server";

/**
 * Pembatalan order terpusat.
 *
 * SEBELUM file ini ada, pembatalan order ditulis tangan di empat tempat dan
 * tidak konsisten: tiga jalur set `status_changed_at` + `terminal_at`, tapi
 * jalur gagal-create-Snap (`POST /api/orders`) hanya set `status` + `updated_at`.
 * Akibatnya order bisa `status = 'cancelled'` dengan `terminal_at = NULL`, dan
 * `terminal_at` justru dipakai `digiflazz/status-service.ts` serta
 * `fulfillment.ts` untuk menentukan transisi status.
 *
 * Semua pembatalan sekarang WAJIB lewat sini supaya tidak bisa lagi tidak sinkron.
 */

export type OrderCancelReason =
  | "points_reservation_failed"
  | "promo_reservation_failed"
  | "snap_create_failed"
  | "expired";

/**
 * Lepas reservasi points dan promo untuk satu order.
 *
 * Aman dipanggil berulang: `nambah_points_restore_redemption` punya guard
 * `idempotency_key = 'restore:<order_id>'` dan `nambah_promotion_release` hanya
 * menyentuh baris berstatus `reserved`/`redeemed`.
 *
 * `allSettled` dipakai supaya kegagalan satu subsystem tidak memblokir yang
 * lain; order tetap sudah dibatalkan dan kedua reservasi dicoba dilepas.
 */
export async function releaseOrderReservations(orderId: string) {
  const results = await Promise.allSettled([
    restoreOrderPointsRedemption(orderId),
    syncPromotionLifecycle(orderId, "cancelled"),
  ]);

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const subsystem = index === 0 ? "Nambah Points" : "promo";
      console.error(
        `${subsystem} release failed for order ${orderId}`,
        result.reason,
      );
    }
  });

  return results.every((result) => result.status === "fulfilled");
}

/**
 * Batalkan order yang masih menunggu pembayaran, lalu lepas reservasinya.
 *
 * Transisi status memakai compare-and-swap: update hanya berlaku kalau order
 * masih `pending_payment`. Ini penting untuk dua hal:
 *
 * 1. Sweeper kedaluwarsa tidak boleh membatalkan order yang pembayarannya
 *    bersamaan saja berhasil — `applyMidtransStatus` sudah memindahkan status
 *    ke `paid`, jadi update di sini tidak cocok dan reservasi tidak dilepas.
 * 2. Pemanggilan ganda (mis. webhook dan cron berbarengan) hanya menghasilkan
 *    satu pembatalan efektif.
 *
 * @returns `true` kalau order benar-benar dibatalkan oleh pemanggilan ini.
 */
export async function cancelOrderWithCleanup(
  orderId: string,
  reason: OrderCancelReason,
): Promise<boolean> {
  const now = new Date().toISOString();

  const cancelled = await supabaseUpdate<{ id: string }>(
    "orders",
    {
      status: "cancelled",
      status_changed_at: now,
      terminal_at: now,
      updated_at: now,
    },
    { filters: { id: `eq.${orderId}`, status: "eq.pending_payment" } },
  );

  if (cancelled.length === 0) return false;

  console.warn(
    `Order ${orderId} cancelled (${reason}) — releasing points/promo reservations`,
  );

  await releaseOrderReservations(orderId);
  return true;
}