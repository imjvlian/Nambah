import { authorizeAdminRequest } from "@/lib/admin-api";
import { bootstrapDigiflazzCatalog } from "@/lib/digiflazz/bootstrap";
import { DigiflazzApiError } from "@/lib/digiflazz/client";

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

    if (error instanceof DigiflazzApiError) {
      const rateLimited = error.code === "83";
      return Response.json(
        {
          error: rateLimited
            ? "Limit pengecekan price-list Digiflazz sedang tercapai. Katalog hasil scan terakhir tetap aman dan bisa dipakai untuk sync harga; coba Scan ulang beberapa saat lagi."
            : error.message,
          providerMessage: error.message,
          code: error.code,
          retryable: error.retryable,
          cachedCatalogUsable: rateLimited,
        },
        { status: rateLimited ? 429 : 502 },
      );
    }

    return Response.json(
      { error: "Bootstrap catalog Digiflazz gagal dijalankan." },
      { status: 502 },
    );
  }
}
