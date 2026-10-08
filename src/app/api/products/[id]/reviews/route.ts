import { getProductRatingSummary } from "@/lib/reviews";

export const runtime = "nodejs";

/**
 * Ringkasan rating publik untuk satu produk. Tidak memuat data pelanggan apa
 * pun — hanya nilai, angka, dan teks ulasan yang sudah ditulis pemilik order.
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
    const summary = await getProductRatingSummary(id, { highlightsLimit: 5 });
    return Response.json(
      { productId: id, ...summary },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("Product rating summary failed", error);
    return Response.json(
      { error: "Rating produk belum dapat dimuat." },
      { status: 502 },
    );
  }
}