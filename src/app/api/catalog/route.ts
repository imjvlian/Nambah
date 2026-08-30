import { getPublicCatalog } from "@/lib/catalog-repository";

export async function GET() {
  try {
    const catalog = await getPublicCatalog();

    return Response.json({
      games: catalog.games,
      paymentMethods: catalog.paymentMethods,
      source: catalog.source,
    });
  } catch (error) {
    console.error("Catalog lookup failed", error);
    return Response.json(
      { error: "Katalog sedang tidak tersedia. Coba lagi." },
      { status: 503 },
    );
  }
}
