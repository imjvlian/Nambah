import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect, supabaseSelectPage } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SupplierCatalogRow = {
  supplier_sku: string;
  product_name: string;
  category: string;
  brand: string;
  type: string;
  seller_name: string;
  supplier_cost: number | string;
  buyer_active: boolean;
  seller_active: boolean;
  unlimited_stock: boolean;
  stock: number | string | null;
  multi: boolean;
  start_cut_off: string | null;
  end_cut_off: string | null;
  description: string | null;
  last_seen_at: string;
};

type SupplierProductRow = {
  product_id: string;
  supplier_sku: string | null;
};

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
};

type GameRow = {
  id: string;
  name: string;
};

function cleanSearch(value: string) {
  return value.replace(/[,%()*]/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(25, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const queryText = cleanSearch(url.searchParams.get("q") ?? "");
  const availability = url.searchParams.get("availability") ?? "all";

  try {
    const [latestRows, supplierProducts, products, games] = await Promise.all([
      supabaseSelect<{ last_seen_at: string }>("supplier_catalog_items", {
        select: "last_seen_at",
        filters: { supplier_id: "eq.digiflazz" },
        order: "last_seen_at.desc",
        limit: 1,
      }),
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku",
        filters: { supplier_id: "eq.digiflazz", supplier_sku: "not.is.null" },
      }),
      supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label",
        order: "game_id.asc,sort_order.asc,label.asc",
      }),
      supabaseSelect<GameRow>("games", {
        select: "id,name",
        order: "sort_order.asc,name.asc",
      }),
    ]);

    const latestScanAt = latestRows[0]?.last_seen_at ?? null;
    if (!latestScanAt) {
      return Response.json({
        latestScanAt: null,
        total: 0,
        page,
        limit,
        pages: 0,
        items: [],
        nambahProducts: products.map((product) => ({
          id: product.id,
          gameId: product.game_id,
          gameName: games.find((game) => game.id === product.game_id)?.name ?? product.game_id,
          label: product.label,
        })),
      });
    }

    const filters: Record<string, string> = {
      supplier_id: "eq.digiflazz",
      last_seen_at: `eq.${latestScanAt}`,
    };

    if (availability === "ready") {
      filters.buyer_active = "eq.true";
      filters.seller_active = "eq.true";
    } else if (availability === "buyer-inactive") {
      filters.buyer_active = "eq.false";
    } else if (availability === "seller-inactive") {
      filters.seller_active = "eq.false";
    }

    const rawQuery = queryText
      ? {
          or: `(supplier_sku.ilike.*${queryText}*,product_name.ilike.*${queryText}*,brand.ilike.*${queryText}*,category.ilike.*${queryText}*,type.ilike.*${queryText}*,seller_name.ilike.*${queryText}*)`,
        }
      : undefined;

    const result = await supabaseSelectPage<SupplierCatalogRow>("supplier_catalog_items", {
      select:
        "supplier_sku,product_name,category,brand,type,seller_name,supplier_cost,buyer_active,seller_active,unlimited_stock,stock,multi,start_cut_off,end_cut_off,description,last_seen_at",
      filters,
      query: rawQuery,
      order: "brand.asc,product_name.asc,supplier_sku.asc",
      limit,
      offset: (page - 1) * limit,
    });

    const productsById = new Map(products.map((product) => [product.id, product]));
    const gamesById = new Map(games.map((game) => [game.id, game]));
    const mappedBySku = new Map(
      supplierProducts
        .filter((row) => row.supplier_sku)
        .map((row) => [row.supplier_sku!.toUpperCase(), row.product_id]),
    );

    const total = result.count ?? result.data.length;

    return Response.json({
      latestScanAt,
      total,
      page,
      limit,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
      items: result.data.map((item) => {
        const mappedProductId = mappedBySku.get(item.supplier_sku.toUpperCase()) ?? null;
        const mappedProduct = mappedProductId ? productsById.get(mappedProductId) : null;
        return {
          sku: item.supplier_sku,
          name: item.product_name,
          category: item.category,
          brand: item.brand,
          type: item.type,
          seller: item.seller_name,
          cost: Number(item.supplier_cost),
          buyerActive: item.buyer_active,
          sellerActive: item.seller_active,
          unlimitedStock: item.unlimited_stock,
          stock: item.stock === null ? null : Number(item.stock),
          multi: item.multi,
          startCutOff: item.start_cut_off,
          endCutOff: item.end_cut_off,
          description: item.description,
          lastSeenAt: item.last_seen_at,
          mapping: mappedProductId
            ? {
                productId: mappedProductId,
                label: mappedProduct?.label ?? mappedProductId,
                gameName: mappedProduct
                  ? gamesById.get(mappedProduct.game_id)?.name ?? mappedProduct.game_id
                  : null,
              }
            : null,
        };
      }),
      nambahProducts: products.map((product) => ({
        id: product.id,
        gameId: product.game_id,
        gameName: gamesById.get(product.game_id)?.name ?? product.game_id,
        label: product.label,
      })),
    });
  } catch (error) {
    console.error("Digiflazz supplier catalog browse failed", error);
    return Response.json(
      { error: "Katalog supplier Digiflazz tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
