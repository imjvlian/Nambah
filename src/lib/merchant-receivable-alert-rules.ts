/**
 * Penyusun pesan alert piutang merchant — bagian MURNI, tanpa I/O.
 *
 * Terpisah dari `merchant-receivable-alert.ts` karena modul itu mengirim
 * pesan sungguhan ke Telegram. Isi pesan adalah hal yang dibaca admin setiap
 * jam, jadi harus bisa diuji tanpa database dan tanpa network.
 *
 * Klasifikasi angka (overdue / due soon) TIDAK diulang di sini. File ini
 * menerima status yang sudah diklasifikasi oleh `classifyReceivables` dan
 * hanya memutuskan bagian mana yang ditampilkan.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export type ReceivableAlertRow = {
  merchantId: string;
  merchantName: string;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  dueSoon: number;
  dueSoonCount: number;
  oldestDueAt: string | null;
};

export function formatIDR(value: number) {
  const rounded = Math.round(Number(value) || 0);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}Rp${Math.abs(rounded).toLocaleString("id-ID")}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Berapa hari lagi (atau sudah berapa hari lalu) sebuah tenggat.
 *
 * String relatif dipakai karena admin tidak melihat tanggal absolut di
 * notifikasi: "3 hari lagi" jauh lebih bisa ditindaklanjuti daripada
 * "2026-10-13T00:00:00Z". Tanggal penuh tetap ada di baris detail.
 */
export function relativeDueLabel(dueAt: string, now: number) {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return "tidak diketahui";

  const days = Math.ceil((due - now) / DAY_MS);

  if (days < 0) {
    const overdueBy = Math.abs(days);
    return overdueBy === 1 ? "telat 1 hari" : `telat ${overdueBy} hari`;
  }
  if (days === 0) return "jatuh tempo hari ini";
  if (days === 1) return "jatuh tempo besok";
  return `jatuh tempo ${days} hari lagi`;
}

/**
 * Pisahkan merchant yang perlu ditegur dari yang belum.
 *
 * Hanya `overdue` dan `due_soon` yang masuk alert. Merchant yang masih jauh
 * dari tenggat tidak diberi tahu: belum terlambat, dan mengirim pengingat
 * ke merchant yang behave benar hanya menimbulkan rasa bersalah tanpa
 * melindungi apa pun - plus mengajari mereka bahwa notifikasi Lacte bisa
 * diabaikan.
 */
export function selectAlertable(
  statuses: ReceivableAlertRow[],
): { overdue: ReceivableAlertRow[]; dueSoon: ReceivableAlertRow[] } {
  const overdue: ReceivableAlertRow[] = [];
  const dueSoon: ReceivableAlertRow[] = [];

  for (const status of statuses) {
    if (status.overdueCount > 0) overdue.push(status);
    else if (status.dueSoonCount > 0) dueSoon.push(status);
  }

  return { overdue, dueSoon };
}

/**
 * Susun pesan HTML.
 *
 * Mengembalikan `null` kalau tidak ada yang perlu dilaporkan. Memanggil route
 * cron dengan hasil kosong akan mengirim pesan kosong ke Telegram setiap jam -
 * itu bukan hal yang benar, dan Telegram akan tetap membalas 200.
 */
export function buildReceivableAlert(
  statuses: ReceivableAlertRow[],
  now = Date.now(),
): string | null {
  const { overdue, dueSoon } = selectAlertable(statuses);

  if (overdue.length === 0 && dueSoon.length === 0) return null;

  const totalOverdue = overdue.reduce((sum, row) => sum + row.overdue, 0);
  const totalDueSoon = dueSoon.reduce((sum, row) => sum + row.dueSoon, 0);
  const totalOutstanding = statuses.reduce(
    (sum, row) => sum + row.outstanding,
    0,
  );

  const lines: string[] = [];

  if (overdue.length > 0) {
    lines.push(
      `<b>Piutang lewat tenggat</b> — ${overdue.length} merchant, ${formatIDR(totalOverdue)}`,
    );
    for (const row of overdue) {
      lines.push(
        `• <b>${escapeHtml(row.merchantName)}</b> — ${formatIDR(row.overdue)} dari ${formatIDR(row.outstanding)}` +
          ` (${row.overdueCount} tagihan, ` +
          `${escapeHtml(row.oldestDueAt ? relativeDueLabel(row.oldestDueAt, now) : "tidak diketahui")})`,
      );
    }
  }

  if (dueSoon.length > 0) {
    lines.push("");
    lines.push(
      `<b>Segera jatuh tempo</b> — ${dueSoon.length} merchant, ${formatIDR(totalDueSoon)}`,
    );
    for (const row of dueSoon) {
      lines.push(
        `• <b>${escapeHtml(row.merchantName)}</b> — ${formatIDR(row.dueSoon)}` +
          ` (${row.dueSoonCount} tagihan, ` +
          `${escapeHtml(row.oldestDueAt ? relativeDueLabel(row.oldestDueAt, now) : "tidak diketahui")})`,
      );
    }
  }

  lines.push("");
  lines.push(`Total piutang berjalan: <b>${formatIDR(totalOutstanding)}</b>`);

  return lines.join("\n");
}

/**
 * Kunci dedupe per merchant dan per jam.
 *
 * Pola ini mengikuti `supplier-balance.ts` (transisi status yang sama dalam
 * satu jam cukup satu pesan). Tanpa itu, cron yang berjalan tiap jam akan
 * mengirim pesan yang persis sama berulang-ulang selama piutang tidak berubah
 * - dan merchant yang diberi tahu berulang biasanya berhenti membaca.
 */
export function buildReceivableDedupeKey(
  merchantId: string,
  bucket: "overdue" | "due-soon",
  checkedAt: string,
) {
  return `receivable:${merchantId}:${bucket}:${checkedAt.slice(0, 13)}`;
}