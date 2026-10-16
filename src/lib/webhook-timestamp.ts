/**
 * Guard anti-replay untuk webhook payment.
 *
 * Signature webhook membuktikan dua hal: request berasal dari penyedia dan
 * body tidak berubah. Tapi tanpa batas waktu, request sah yang tertangkap
 * bisa diputar ulang kapan pun. Transisi status order sebagian besar sudah
 * monotonik, jadi replay umumnya tidak berbahaya; guard ini menutup sisa
 * jalur seperti notifikasi refund yang datang terlambat.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export function isFreshWebhookTimestamp(
  timestamp: string | null,
  now = Date.now(),
): boolean {
  if (!timestamp) return false;

  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;

  const drift = Math.abs(now - parsed);
  return drift <= WEBHOOK_TIMESTAMP_TOLERANCE_MS;
}
