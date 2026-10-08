import { getGameRatingSummary } from "@/lib/reviews";

export const runtime = "nodejs";

/**
 * Ringkasan rating untuk seluruh nominal dalam satu game. Dipakai halaman
 * produk agar cukup satu permintaan HTTP, bukan satu per nominal.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Produk tidak valid." }, { status: 400 });
  }

  try {
    const summary = await getGameRatingSummary(id, {
      topProductsLimit: 5,
      highlightsLimit: 5,
    });
    return Response.json(
      { gameId: id, ...summary },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("Game rating summary failed", error);
    return Response.json(
      { error: "Rating belum dapat dimuat." },
      { status: 502 },
    );
  }
}