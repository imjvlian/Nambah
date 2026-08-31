import { authorizeCronRequest } from "@/lib/cron-api";
import { checkDigiflazzSupplierBalance } from "@/lib/supplier-balance";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await checkDigiflazzSupplierBalance({
      source: "periodic",
      notify: true,
    });
    return Response.json(result);
  } catch (error) {
    console.error("Periodic Digiflazz balance check failed", error);
    return Response.json({ error: "Periodic balance check gagal dijalankan." }, { status: 502 });
  }
}
