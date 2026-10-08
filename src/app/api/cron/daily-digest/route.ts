import { authorizeCronRequest } from "@/lib/cron-api";
import { sendDailyDigest } from "@/lib/daily-digest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Digest harian, dijadwalkan 01:00 UTC = 08:00 WIB.
 *
 * Tanpa `date`, laporan mencakup satu hari WIB sebelumnya. Kalau tanggal itu
 * sudah pernah terkirim, request ini di-skip — jadi timer yang terpicu dua kali
 * tidak mengirim ulang.
 *
 * `?date=YYYY-MM-DD&force=1` untuk mengulang tanggal tertentu (recovery).
 * `date` ditafsirkan sebagai tanggal WIB.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const dateKey = params.get("date")?.trim() || undefined;
  const force = params.get("force") === "1";

  if (dateKey && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return Response.json(
      { error: "Format date harus YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const result = await sendDailyDigest({ dateKey, force });
    return Response.json(result);
  } catch (error) {
    console.error("Daily digest failed", error);
    return Response.json({ error: "Digest harian gagal dikirim." }, { status: 502 });
  }
}