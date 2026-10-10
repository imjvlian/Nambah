import "server-only";

import {
  buildReceivableAlert,
  buildReceivableDedupeKey,
  selectAlertable,
  type ReceivableAlertRow,
} from "@/lib/merchant-receivable-alert-rules";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Kirim alert piutang ke Telegram.
 *
 * TIGA KEPUTUSAN YANG MEMBUAT INI TIDAK MENJADI SPAM:
 *
 * 1. Tidak ada piutang terlambat = tidak ada pesan. `buildReceivableAlert`
 *    mengembalikan `null`, dan route cron berhenti di situ. Cron yang berjalan
 *    tiap jam tidak boleh mengirim pesan kosong.
 *
 * 2. `dedupeKey` per merchant per jam. Kalau cron terpicu dua kali dalam jam
 *    yang sama - deploy, restart worker, atau timer yang tumpang tindih -
 *    `telegram_delivery_log` menolak baris kedua karena `dedupe_key` unik.
 *    Ini pola yang sama dengan `supplier-balance.ts`.
 *
 * 3. Telegram belum dikonfigurasi BUKAN kegagalan. `sendTelegramMessage`
 *    sudah mengembalikan `{ sent: false, reason: "not-configured" }` dan
 *    mencatat `skipped`. Cron mengembalikan sukses supaya health check tidak
 *    berubah jadi merah hanya karena `TELEGRAM_ADMIN_CHAT_ID` belum diisi.
 */

export type ReceivableNotificationResult = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  reason: "not-needed" | "not-configured" | "sent" | "partial" | "failed";
};

export async function sendMerchantReceivableAlerts(
  statuses: ReceivableAlertRow[],
  now = Date.now(),
): Promise<ReceivableNotificationResult> {
  const text = buildReceivableAlert(statuses, now);

  if (!text) {
    return {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      reason: "not-needed",
    };
  }

  const result: ReceivableNotificationResult = {
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    reason: "sent",
  };

  const { overdue, dueSoon } = selectAlertable(statuses);
  const checkedAt = new Date(now).toISOString();

  /*
   * Satu pesan per merchant, bukan satu pesan untuk semua.
   *
   * `dedupeKey` memuat merchant id karena itu satu-satunya cara dedupe-nya bekerja:
   * kalau semua merchant berbagi satu kunci, pesan merchant kedua akan
   * ditolak sebagai duplikat dan piutang merchant itu tidak pernah sampai
   * ke admin.
   */
  const queues = [
    ...overdue.map((row) => ({
      row,
      bucket: "overdue" as const,
      detail: `Piutang lewat tenggat: ${row.overdueCount} tagihan, Rp${row.overdue.toLocaleString("id-ID")}. Tertua ${row.oldestDueAt ?? "tidak diketahui"}.`,
    })),
    ...dueSoon.map((row) => ({
      row,
      bucket: "due-soon" as const,
      detail: `Segera jatuh tempo: ${row.dueSoonCount} tagihan, Rp${row.dueSoon.toLocaleString("id-ID")}.`,
    })),
  ];

  for (const item of queues) {
    result.attempted += 1;

    const body =
      `<b>${item.row.merchantName}</b>\n${item.detail}\n` +
      `Total outstanding: Rp${item.row.outstanding.toLocaleString("id-ID")}`;

    try {
      const sent = await sendTelegramMessage(body, {
        kind: "receivable",
        dedupeKey: buildReceivableDedupeKey(
          item.row.merchantId,
          item.bucket,
          checkedAt,
        ),
        parseMode: "HTML",
      });

      if (sent.sent) result.sent += 1;
      else result.skipped += 1;
    } catch (error) {
      /*
       * Satu merchant gagal tidak boleh menghentikan sisa antrean.
       *
       * Kalau error melempar keluar loop, merchant setelah posisi ini tidak
       * akan pernah diberi tahu sama sekali - dan justru merchant yang paling
       * terlambat biasanya ada di urutan belakang.
       */
      result.failed += 1;
      console.error(
        `Telegram receivable alert failed for merchant ${item.row.merchantId}`,
        error,
      );
    }
  }

  if (result.sent === 0 && result.attempted > 0 && result.failed === 0) {
    result.reason = "not-configured";
  } else if (result.failed > 0) {
    result.reason = result.sent > 0 ? "partial" : "failed";
  }

  return result;
}