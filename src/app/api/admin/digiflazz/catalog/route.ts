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

type FilterOptionRow = {
  supplier_sku: string;
  category: string;
  brand: string;
  type: string;
  seller_name: string;
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

function cleanExact(value: string | null) {
  return (value ?? "").trim().slice(0, 180);
}

function quotedInFilter(values: string[]) {
  return `in.(${values
    .map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")})`;
}

function sortOptions(values: Set<string>) {
  return Array.from(values)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "id", { sensitivity: "base" }));
}

async function loadFilterOptions(latestScanAt: string) {
  const categories = new Set<string>();
  const brands = new Set<string>();
  const types = new Set<string>();
  const sellers = new Set<string>();
  const batchSize = 1000;
  let offset = 0;
  let scanTotal = 0;

  while (true) {
    const batch = await supabaseSelectPage<FilterOptionRow>("supplier_catalog_items", {
      select: "supplier_sku,category,brand,type,seller_name",
      filters: {
        supplier_id: "eq.digiflazz",
        last_seen_at: `eq.${latestScanAt}`,
      },
      order: "supplier_sku.asc",
      limit: batchSize,
      offset,
    });

    if (batch.count !== null) scanTotal = batch.count;

    for (const item of batch.data) {
      if (item.category) categories.add(item.category);
      if (item.brand) brands.add(item.brand);
      if (item.type) types.add(item.type);
      if (item.seller_name) sellers.add(item.seller_name);
    }

    if (batch.data.length === 0) break;
    offset += batch.data.length;
    if (batch.count !== null && offset >= batch.count) break;
    if (batch.count === null && batch.data.length < batchSize) break;
  }

  return {
    scanTotal,
    filterOptions: {
      categories: sortOptions(categories),
      brands: sortOptions(brands),
      types: sortOptions(types),
      sellers: sortOptions(sellers),
    },
  };
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(25, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const queryText = cleanSearch(url.searchParams.get("q") ?? "");
  const availability = cleanExact(url.searchParams.get("availability")) || "all";
  const category = cleanExact(url.searchParams.get("category")) || "all";
  const brand = cleanExact(url.searchParams.get("brand")) || "all";
  const type = cleanExact(url.searchParams.get("type")) || "all";
  const seller = cleanExact(url.searchParams.get("seller")) || "all";
  const mapping = cleanExact(url.searchParams.get("mapping")) || "all";
  const transactionMode = cleanExact(url.searchParams.get("mode")) || "all";
  const includeOptions = url.searchParams.get("includeOptions") !== "false";

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
    const gamesById = new Map(games.map((game) => [game.id, game]));
    const nambahProducts = products.map((product) => ({
      id: product.id,
      gameId: product.game_id,
      gameName: gamesById.get(product.game_id)?.name ?? product.game_id,
      label: product.label,
    }));

    if (!latestScanAt) {
      return Response.json({
        latestScanAt: null,
        scanTotal: 0,
        total: 0,
        page,
        limit,
        pages: 0,
        items: [],
        filterOptions: {
          categories: [],
          brands: [],
          types: [],
          sellers: [],
        },
        nambahProducts,
      });
    }

    const mappedSupplierSkus = supplierProducts
      .map((row) => row.supplier_sku?.trim() ?? "")
      .filter(Boolean);

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

    if (category !== "all") filters.category = `eq.${category}`;
    if (brand !== "all") filters.brand = `eq.${brand}`;
    if (type !== "all") filters.type = `eq.${type}`;
    if (seller !== "all") filters.seller_name = `eq.${seller}`;
    if (transactionMode === "multi") filters.multi = "eq.true";
    if (transactionMode === "single") filters.multi = "eq.false";

    let mappingForcesEmpty = false;
    if (mapping === "mapped") {
      if (mappedSupplierSkus.length === 0) {
        mappingForcesEmpty = true;
      } else {
        filters.supplier_sku = quotedInFilter(mappedSupplierSkus);
      }
    } else if (mapping === "unmapped" && mappedSupplierSkus.length > 0) {
      filters.supplier_sku = `not.${quotedInFilter(mappedSupplierSkus)}`;
    }

    const rawQuery = queryText
      ? {
          or: `(supplier_sku.ilike.*${queryText}*,product_name.ilike.*${queryText}*,brand.ilike.*${queryText}*,category.ilike.*${queryText}*,type.ilike.*${queryText}*,seller_name.ilike.*${queryText}*)`,
        }
      : undefined;

    const scanMetaPromise = includeOptions
      ? loadFilterOptions(latestScanAt)
      : supabaseSelectPage<{ supplier_sku: string }>("supplier_catalog_items", {
          select: "supplier_sku",
          filters: {
            supplier_id: "eq.digiflazz",
            last_seen_at: `eq.${latestScanAt}`,
          },
          limit: 1,
          offset: 0,
        }).then((result) => ({
          scanTotal: result.count ?? result.data.length,
          filterOptions: undefined,
        }));

    const resultPromise = mappingForcesEmpty
      ? Promise.resolve({ data: [] as SupplierCatalogRow[], count: 0 })
      : supabaseSelectPage<SupplierCatalogRow>("supplier_catalog_items", {
          select:
            "supplier_sku,product_name,category,brand,type,seller_name,supplier_cost,buyer_active,seller_active,unlimited_stock,stock,multi,start_cut_off,end_cut_off,description,last_seen_at",
          filters,
          query: rawQuery,
          order: "brand.asc,product_name.asc,supplier_sku.asc",
          limit,
          offset: (page - 1) * limit,
        });

    const [scanMeta, result] = await Promise.all([scanMetaPromise, resultPromise]);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const mappedBySku = new Map(
      supplierProducts
        .filter((row) => row.supplier_sku)
        .map((row) => [row.supplier_sku!.toUpperCase(), row.product_id]),
    );
    const total = result.count ?? result.data.length;

    return Response.json({
      latestScanAt,
      scanTotal: scanMeta.scanTotal,
      total,
      page,
      limit,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
      filterOptions: scanMeta.filterOptions,
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
      nambahProducts,
    });
  } catch (error) {
    console.error("Digiflazz supplier catalog browse failed", error);
    return Response.json(
      { error: "Katalog supplier Digiflazz tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
