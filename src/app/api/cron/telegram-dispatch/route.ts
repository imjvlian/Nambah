import { authorizeCronRequest } from "@/lib/cron-api";
import { drainTelegramQueue } from "@/lib/telegram";

export const runtime = "nodejs";
// 20 pesan x 1,1 detik jeda = ~22 detik. Default timeout Next.js cukup, tapi
// VPS tidak punya batas seperti function serverless.
export const maxDuration = 60;

/**
 * Drain antrean Telegram.
 *
 * Dipanggil timer systemd tiap menit. Alert fullness dan receipt gagal masuk
 * antrean (`status: pending`), bukan dikirim langsung, supaya rate limit
 * Telegram tidak menyebabkan alert hilang.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const limitParam = new URL(request.url).searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam ?? 20) || 20, 1), 50);

    return Response.json(await drainTelegramQueue(limit));
  } catch (error) {
    console.error("Telegram dispatch failed", error);
    return Response.json({ error: "Antrean Telegram gagal diproses." }, { status: 502 });
  }
}