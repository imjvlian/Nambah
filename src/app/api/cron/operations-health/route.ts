import { authorizeCronRequest } from "@/lib/cron-api";
import { getOperationsHealth } from "@/lib/operations-health";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await getOperationsHealth({ source: "cron" }));
  } catch (error) {
    console.error("Operations health cron failed", error);
    return Response.json({ error: "Operations health cron gagal." }, { status: 502 });
  }
}
