import { authorizeCronRequest } from "@/lib/cron-api";
import { sendMerchantReceivableAlerts } from "@/lib/merchant-receivable-alert";
import {
  collectMerchantReceivableStatuses,
  snapshotMerchantReceivables,
} from "@/lib/merchant-receivable-cron";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cron alert piutang merchant.
 *
 * Dua tahap yang sengaja dipisah:
 *
 *   1. Hitung + snapshot posisi piutang setiap merchant.
 *   2. Kirim alert HANYA untuk yang perlu ditegur.
 *
 * Pemisahan ini penting karena keduanya punya toleransi kegagalan yang
 * berbeda. Kalau gather gagal, tidak ada yang dikirim dan respons 502 supaya
 * cron berikutnya mencoba lagi. Kalau gather berhasil tapi Telegram gagal,
 * snapshot tetap tersimpan dan respons tetap 200 - angka piutang sudah benar
 * di database, dan kegagalannya cuma soal notifications.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const now = Date.now();
    const statuses = await collectMerchantReceivableStatuses(now);
    const snapshotted = await snapshotMerchantReceivables(statuses);

    const notification = await sendMerchantReceivableAlerts(statuses, now);

    const overdue = statuses.filter((status) => status.overdueCount > 0);
    const dueSoon = statuses.filter(
      (status) => status.overdueCount === 0 && status.dueSoonCount > 0,
    );

    return Response.json({
      checkedAt: new Date(now).toISOString(),
      merchantsWithReceivable: statuses.length,
      snapshotted,
      overdue: overdue.length,
      overdueAmount: overdue.reduce((sum, row) => sum + row.overdue, 0),
      dueSoon: dueSoon.length,
      dueSoonAmount: dueSoon.reduce((sum, row) => sum + row.dueSoon, 0),
      outstanding: statuses.reduce((sum, row) => sum + row.outstanding, 0),
      notification,
      // Daftar per merchant ikut dikembalikan supaya cron bisa dipakai
      // sebagai alat diagnosis: "kenapa merchant ini tidak dapat alert?"
      // bisa dijawab tanpa membuka database.
      statuses,
    });
  } catch (error) {
    console.error("Merchant receivable cron failed", error);
    return Response.json(
      { error: "Pemeriksaan piutang merchant gagal dijalankan." },
      { status: 502 },
    );
  }
}