import { authorizeAdminRequest } from "@/lib/admin-api";
import {
  supabaseSelect,
  supabaseSelectAll,
  supabaseSelectPage,
} from "@/lib/supabase/server";

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
  active: boolean;
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

function sortOptions(values: Set<string>) {
  return Array.from(values)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "id", { sensitivity: "base" }));
}

/**
 * Filter mapping/visibility diterapkan di JS (bukan SQL) — menyusunnya sebagai
 * `in.(...)`/`not.in.(...)` dengan ribuan SKU membuat URL melebihi batas
 * PostgREST dan request selalu gagal. Scan katalog cukup kecil untuk diproses
 * di memori setelah filter ringan diterapkan di DB.
 */
function resolveSkuFilter(
  mapping: string,
  visibility: string,
  mappedSkus: Set<string>,
  publishedSkus: Set<string>,
) {
  if (mapping === "unmapped" && visibility === "published") {
    return { empty: true, keep: null as ((sku: string) => boolean) | null };
  }
  if (mapping === "mapped" && visibility === "published") {
    return {
      empty: publishedSkus.size === 0,
      keep: (sku: string) => publishedSkus.has(sku.trim().toUpperCase()),
    };
  }
  if (mapping === "mapped" && visibility === "hidden") {
    return {
      empty: Array.from(mappedSkus).every((sku) => publishedSkus.has(sku)),
      keep: (sku: string) => {
        const key = sku.trim().toUpperCase();
        return mappedSkus.has(key) && !publishedSkus.has(key);
      },
    };
  }
  if (mapping === "unmapped") {
    return {
      empty: false,
      keep: (sku: string) => !mappedSkus.has(sku.trim().toUpperCase()),
    };
  }
  if (mapping === "mapped") {
    return {
      empty: mappedSkus.size === 0,
      keep: (sku: string) => mappedSkus.has(sku.trim().toUpperCase()),
    };
  }
  if (visibility === "published") {
    return {
      empty: publishedSkus.size === 0,
      keep: (sku: string) => publishedSkus.has(sku.trim().toUpperCase()),
    };
  }
  if (visibility === "hidden") {
    return {
      empty: false,
      keep: (sku: string) => !publishedSkus.has(sku.trim().toUpperCase()),
    };
  }
  return { empty: false, keep: null as ((sku: string) => boolean) | null };
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
  const visibility = cleanExact(url.searchParams.get("visibility")) || "all";
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
      supabaseSelectAll<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku",
        filters: { supplier_id: "eq.digiflazz", supplier_sku: "not.is.null" },
      }),
      supabaseSelectAll<ProductRow>("products", {
        select: "id,game_id,label,active",
        order: "game_id.asc,sort_order.asc,label.asc",
      }),
      supabaseSelectAll<GameRow>("games", {
        select: "id,name",
        order: "sort_order.asc,name.asc",
      }),
    ]);

    const latestScanAt = latestRows[0]?.last_seen_at ?? null;
    const gamesById = new Map(games.map((game) => [game.id, game]));
    const productsById = new Map(products.map((product) => [product.id, product]));
    const nambahProducts = products.map((product) => ({
      id: product.id,
      gameId: product.game_id,
      gameName: gamesById.get(product.game_id)?.name ?? product.game_id,
      label: product.label,
      active: product.active,
    }));

    const mappedSkus = new Set(
      supplierProducts
        .map((row) => row.supplier_sku?.trim().toUpperCase() ?? "")
        .filter(Boolean),
    );
    const publishedSkus = new Set(
      supplierProducts
        .filter((row) => {
          if (!row.supplier_sku) return false;
          return Boolean(productsById.get(row.product_id)?.active);
        })
        .map((row) => row.supplier_sku!.trim().toUpperCase()),
    );

    if (!latestScanAt) {
      return Response.json({
        latestScanAt: null,
        scanTotal: 0,
        publishedCount: publishedSkus.size,
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

    const skuFilter = resolveSkuFilter(mapping, visibility, mappedSkus, publishedSkus);

    const rawQuery = queryText
      ? {
          or: `(supplier_sku.ilike.*${queryText}*,product_name.ilike.*${queryText}*,brand.ilike.*${queryText}*,category.ilike.*${queryText}*,type.ilike.*${queryText}*,seller_name.ilike.*${queryText}*)`,
        }
      : undefined;

    // Filter ringan (availability/category/brand/type/seller/mode/search)
    // tetap di DB; filter SKU mapping/visibility diterapkan di JS sesudahnya.
    const scanItemsPromise = skuFilter.empty
      ? Promise.resolve([] as SupplierCatalogRow[])
      : supabaseSelectAll<SupplierCatalogRow>("supplier_catalog_items", {
          select:
            "supplier_sku,product_name,category,brand,type,seller_name,supplier_cost,buyer_active,seller_active,unlimited_stock,stock,multi,start_cut_off,end_cut_off,description,last_seen_at",
          filters,
          query: rawQuery,
          order: "brand.asc,product_name.asc,supplier_sku.asc",
        });

    const scanTotalPromise = supabaseSelectPage<{ supplier_sku: string }>(
      "supplier_catalog_items",
      {
        select: "supplier_sku",
        filters: {
          supplier_id: "eq.digiflazz",
          last_seen_at: `eq.${latestScanAt}`,
        },
        limit: 1,
        offset: 0,
      },
    ).then((result) => result.count ?? result.data.length);

    const [scanItems, scanTotal] = await Promise.all([scanItemsPromise, scanTotalPromise]);

    const kept = skuFilter.keep ? scanItems.filter((item) => skuFilter.keep!(item.supplier_sku)) : scanItems;
    const total = kept.length;
    const pages = total === 0 ? 0 : Math.ceil(total / limit);
    const safePage = Math.min(page, Math.max(1, pages || 1));
    const pageItems = kept.slice((safePage - 1) * limit, safePage * limit);

    // Opsi filter dihitung dari set hasil filter atribut (sebelum filter
    // mapping), menggantikan loop loadFilterOptions yang lama.
    const filterOptions = includeOptions
      ? {
          categories: sortOptions(new Set(scanItems.map((item) => item.category))),
          brands: sortOptions(new Set(scanItems.map((item) => item.brand))),
          types: sortOptions(new Set(scanItems.map((item) => item.type))),
          sellers: sortOptions(new Set(scanItems.map((item) => item.seller_name))),
        }
      : undefined;

    const mappedBySku = new Map(
      supplierProducts
        .filter((row) => row.supplier_sku)
        .map((row) => [row.supplier_sku!.toUpperCase(), row.product_id]),
    );

    return Response.json({
      latestScanAt,
      scanTotal,
      publishedCount: publishedSkus.size,
      total,
      page: safePage,
      limit,
      pages,
      filterOptions,
      items: pageItems.map((item) => {
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
                published: Boolean(mappedProduct?.active),
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
