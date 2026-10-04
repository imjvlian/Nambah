import { authorizeAdminRequest } from "@/lib/admin-api";
import { getOperationsHealth } from "@/lib/operations-health";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await getOperationsHealth({ source: "admin" }));
  } catch (error) {
    console.error("Admin operations health failed", error);
    return Response.json({ error: "Operations health gagal dimuat." }, { status: 502 });
  }
}
