import { authorizeAdminRequest } from "@/lib/admin-api";
import {
  buildDailyDigest,
  formatDailyDigest,
  sendDailyDigest,
} from "@/lib/daily-digest";
import { previousWibDateKey, wibDateKey } from "@/lib/time-wib";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Endpoint admin untuk digest harian.
 *
 * Ada karena scheduler tidak bisa diuji dari laptop: cepat atau lambat, tidak
 * ada cara memastikan isi digest benar sebelum dikirim ke chat sungguhan.
 *
 * - `GET  ?date=YYYY-MM-DD` -> lihat pratinjau tanpa mengirim
 * - `POST ?date=YYYY-MM-DD&force=1` -> kirim (dilewati kalau sudah terkirim)
 */
export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const dateKey = resolveDateKey(params.get("date"));

  if (dateKey === null) {
    return Response.json(
      { error: "Format date harus YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const digest = await buildDailyDigest(dateKey);
    return Response.json({
      dateKey,
      message: formatDailyDigest(digest),
      digest,
    });
  } catch (error) {
    console.error("Daily digest preview failed", error);
    return Response.json({ error: "Digest tidak dapat dihitung." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const dateKey = resolveDateKey(params.get("date"));

  if (dateKey === null) {
    return Response.json(
      { error: "Format date harus YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const result = await sendDailyDigest({
      dateKey,
      force: params.get("force") === "1",
    });

    return Response.json({
      ...result,
      dateKey: "dateKey" in result ? result.dateKey : dateKey,
    });
  } catch (error) {
    console.error("Daily digest send failed", error);
    return Response.json({ error: "Digest gagal dikirim." }, { status: 502 });
  }
}

function resolveDateKey(raw: string | null) {
  const trimmed = raw?.trim();
  if (!trimmed) return previousWibDateKey(wibDateKey(new Date()));
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}