import { authorizeAdminRequest } from "@/lib/admin-api";
import { bootstrapDigiflazzCatalog } from "@/lib/digiflazz/bootstrap";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: { apply?: boolean; remap?: boolean } = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ error: "Request bootstrap Digiflazz tidak valid." }, { status: 400 });
  }

  try {
    const result = await bootstrapDigiflazzCatalog({
      apply: body.apply === true,
      remap: body.remap === true,
    });
    return Response.json(result);
  } catch (error) {
    console.error("Digiflazz bootstrap failed", error);
    return Response.json(
      { error: "Bootstrap catalog Digiflazz gagal dijalankan." },
      { status: 502 },
    );
  }
}
