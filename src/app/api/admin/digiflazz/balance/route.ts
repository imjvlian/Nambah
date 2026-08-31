import { authorizeAdminRequest } from "@/lib/admin-api";
import { checkDigiflazzSupplierBalance } from "@/lib/supplier-balance";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let notify = false;
  try {
    const raw = await request.text();
    if (raw) {
      const body = JSON.parse(raw) as { notify?: boolean };
      notify = body.notify === true;
    }
  } catch {
    return Response.json({ error: "Request cek saldo tidak valid." }, { status: 400 });
  }

  try {
    const result = await checkDigiflazzSupplierBalance({
      source: "manual",
      notify,
    });
    return Response.json(result);
  } catch (error) {
    console.error("Digiflazz balance check failed", error);
    return Response.json({ error: "Cek saldo Digiflazz gagal dijalankan." }, { status: 502 });
  }
}
