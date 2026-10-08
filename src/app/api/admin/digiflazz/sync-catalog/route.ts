import { authorizeAdminRequest } from "@/lib/admin-api";
import { syncCatalogWithSupplier } from "@/lib/digiflazz/catalog-sync";

export const runtime = "nodejs";

type SyncBody = {
  dryRun?: boolean;
  /** Default true: coba baca live, jatuh ke cache bila Digiflazz menolak/rate-limit. */
  preferLive?: boolean;
};

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  let body: SyncBody = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as SyncBody;
  } catch {
    return Response.json({ error: "Request sinkron katalog tidak valid." }, { status: 400 });
  }

  const dryRun = body.dryRun === true;

  try {
    const summary = await syncCatalogWithSupplier({
      dryRun,
      preferLive: body.preferLive !== false,
    });

    return Response.json({ mode: dryRun ? "preview" : "applied", summary });
  } catch (error) {
    console.error("Catalog sync failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Sinkron katalog gagal dijalankan." },
      { status: 502 },
    );
  }
}