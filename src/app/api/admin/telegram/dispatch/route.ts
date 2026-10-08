import { authorizeAdminRequest } from "@/lib/admin-api";
import { drainTelegramQueue } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Drain antrean Telegram dari panel admin.
 *
 * Timer systemd sudah menjalankan ini tiap menit. Endpoint ini untuk recovery:
 * kalau antrean menumpuk karena timer mati, admin bisa mengosongkannya tanpa
 * menunggu, dan melihat berapa yang berhasil.
 */
export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const limitParam = new URL(request.url).searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam ?? 20) || 20, 1), 50);
    return Response.json(await drainTelegramQueue(limit));
  } catch (error) {
    console.error("Manual Telegram dispatch failed", error);
    return Response.json({ error: "Antrean gagal diproses." }, { status: 502 });
  }
}