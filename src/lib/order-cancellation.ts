import { restoreOrderPointsRedemption } from "@/lib/loyalty";
import { syncPromotionLifecycle } from "@/lib/promotion-service";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import { releaseSupplierReservation } from "@/lib/suppliers/reservation";

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
  | "supplier_balance_insufficient"
  | "supplier_balance_reservation_failed"
  | "expired"
  | "merchant_never_scanned";

/**
 * Status yang masih SEBENARNYA belum dibayar dan masih boleh dibatalkan.
 *
 * `pending_merchant` masuk daftar karena user di jalur ritel sudah melihat
 * nota tapi uangnya belum masuk - nilainya masih di merchant, dan reservasi
 * points/promo masih terkunci. Kalau order seperti itu tidak bisa dibatalkan,
 * reservasinya bocor permanen - bug yang sama seperti yang
 * dulunya cuma ada di sweeper `order-expiry.ts` sebelum ditulis.
 *
 * Yang SENGAJA TIDAK ada: `paid`, `processing`, `awaiting_receivable`,
 * `completed`. Setelah merchant scan, order sudah tidak bisa dibatalkan —
 * top up sudah irrevocably terjadi di supplier dan membatalkannya tidak
 * membatalkan apa pun, hanya menghilangkan bukti piutang merchant.
 */
const CANCELLABLE_STATUSES = ["pending_payment", "pending_merchant"] as const;

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
/**
 * Lepas reservasi saldo supplier untuk satu order.
 *
 * Nominal yang dilepas diambil dari `orders.supplier_cost` - kolom yang
 * sudah jadi snapshot harga saat checkout. Memorial jumlah yang
 * dilepas di tempat lain akan berbeda begitu harga supplier berubah, dan
 * order lama akan melepas nominal yang salah.
 *
 * Order tanpa `supplier_id` atau tanpa supplier yang punya transaksi
 * tidak melakukan apa-apa dan dianggap berhasil. Itu kondisi normal:
 * order yang gagal sebelum memilih supplier tidak pernah mengunci
 * apa pun.
 *
 * Sengaja TIDAK melempar kalau saldonya tidak ditemukan. Fungsi ini
 * dipanggil dari pembatalan order, dan kegagalan di sini tidak boleh
 * membatalkan pembatalannya - order sudah dibayar atau sudah kedaluwarsa,
 * dan membatalkannya lagi hanya akan complicating keadaan.
 */
async function releaseSupplierBalanceForOrder(
  orderId: string,
): Promise<boolean> {
  const [order] = await supabaseSelect<{
    supplier_id: string | null;
    supplier_cost: number | string;
  }>("orders", {
    select: "supplier_id,supplier_cost",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  if (!order?.supplier_id) return true;

  const amount = Math.round(Number(order.supplier_cost));
  if (!Number.isFinite(amount) || amount <= 0) return true;

  return releaseSupplierReservation(order.supplier_id, amount);
}

export async function releaseOrderReservations(orderId: string) {
  const results = await Promise.allSettled([
    restoreOrderPointsRedemption(orderId),
    syncPromotionLifecycle(orderId, "cancelled"),
    releaseSupplierBalanceForOrder(orderId),
  ]);

  /*
   * Nama subsystem diambil dari daftar, bukan dari index.
   *
   * Dulu `index === 0 ? ... : ...` - yang benar selama hanya ada dua
   * pemanggilan. Menambah reservasi supplier jadi tiga, dan ekspresi itu
   * diam-diam menandai "supplier" untuk semua yang di atas indeks 1.
   * Lognya masih terbaca, tapi salah label - persis kelas bug yang paling
   * sulit ditemukan: yang muncul di log, bukan yang hilang dari layar.
   */
  const subsystems = ["Lacte Points", "promo", "saldo supplier"] as const;

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const subsystem = subsystems[index] ?? `subsystem #${index}`;
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
 * masih di salah satu status `CANCELLABLE_STATUSES`. Ini penting untuk tiga hal:
 *
 * 1. Sweeper kedaluwarsa tidak boleh membatalkan order yang pembayarannya
 *    bersamaan saja berhasil — `applyMidtransStatus` sudah memindahkan status
 *    ke `paid`, jadi update di sini tidak cocok dan reservasi tidak dilepas.
 * 2. Pemanggilan ganda (mis. webhook dan cron berbarengan) hanya menghasilkan
 *    satu pembatalan efektif.
 * 3. Order merchant yang SUDAH di-scan merchant tidak boleh dibatalkan oleh
 *    sweeper. Setelah scan, status sudah pindah ke `awaiting_receivable` dan
 *    top up sudah terjadi — membatalkannya hanya menghapus bukti piutang.
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
    {
      filters: {
        id: `eq.${orderId}`,
        status: `in.(${CANCELLABLE_STATUSES.join(",")})`,
      },
    },
  );

  if (cancelled.length === 0) return false;

  console.warn(
    `Order ${orderId} cancelled (${reason}) — releasing points/promo reservations`,
  );

  await releaseOrderReservations(orderId);
  return true;
}
