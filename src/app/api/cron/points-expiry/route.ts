import { authorizeCronRequest } from "@/lib/cron-api";
import { expireNambahPoints } from "@/lib/loyalty";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await expireNambahPoints(500);
    return Response.json({
      lotsProcessed: result?.lotsProcessed ?? 0,
      pointsExpired: result?.pointsExpired ?? 0,
    });
  } catch (error) {
    console.error("Nambah Points expiry cron failed", error);
    return Response.json(
      { error: "Nambah Points expiry cron gagal." },
      { status: 502 },
    );
  }
}
