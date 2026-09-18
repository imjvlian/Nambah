import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { expireNambahPoints } from "@/lib/loyalty";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await expireNambahPoints(500);
    await auditAdminAction(request, {
      action: "points.expire",
      targetType: "loyalty",
      metadata: {
        lotsProcessed: result?.lotsProcessed ?? 0,
        pointsExpired: result?.pointsExpired ?? 0,
      },
    });
    return Response.json(result ?? { lotsProcessed: 0, pointsExpired: 0 });
  } catch (error) {
    console.error("Admin Points expiry failed", error);
    return Response.json(
      { error: "Expiry Nambah Points gagal dijalankan." },
      { status: 502 },
    );
  }
}
