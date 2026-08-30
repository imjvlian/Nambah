import { authorizeAdminRequest } from "@/lib/admin-api";
import { getDigiflazzPrepaidPriceList } from "@/lib/digiflazz/client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() || undefined;
  const category = url.searchParams.get("category")?.trim() || undefined;
  const brand = url.searchParams.get("brand")?.trim() || undefined;
  const type = url.searchParams.get("type")?.trim() || undefined;
  const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 500))
    : 100;

  try {
    const items = await getDigiflazzPrepaidPriceList({ code, category, brand, type });

    return Response.json({
      count: items.length,
      returned: Math.min(items.length, limit),
      items: items.slice(0, limit).map((item) => ({
        sku: item.buyer_sku_code,
        name: item.product_name,
        category: item.category,
        brand: item.brand,
        type: item.type,
        seller: item.seller_name,
        price: Number(item.price),
        buyerActive: item.buyer_product_status,
        sellerActive: item.seller_product_status,
        unlimitedStock: item.unlimited_stock,
        stock: item.unlimited_stock ? null : Number(item.stock),
        multi: item.multi,
        cutOff: {
          start: item.start_cut_off,
          end: item.end_cut_off,
        },
        description: item.desc,
      })),
    });
  } catch (error) {
    console.error("Digiflazz price list failed", error);
    return Response.json(
      { error: "Gagal mengambil price list Digiflazz." },
      { status: 502 },
    );
  }
}
