import { authorizeAdminRequest } from "@/lib/admin-api";
import {
  supabaseInsert,
  supabaseSelect,
  supabaseSelectPage,
  supabaseUpdate,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type SupplierProductRow = {
  product_id: string;
  supplier_sku: string;
  supplier_cost: number | string;
  active: boolean;
  last_synced_at: string | null;
};

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  note: string | null;
  selling_price: number | string;
  reference_price: number | string;
  active: boolean;
};

type PricingRuleRow = {
  minimum_nambah_profit: number | string;
};

type SupplierCatalogRow = {
  supplier_sku: string;
  product_name: string;
  brand: string;
  type: string;
  supplier_cost: number | string;
  buyer_active: boolean;
  seller_active: boolean;
  stock: number | string | null;
  unlimited_stock: boolean;
  last_seen_at: string;
};

type SyncBody = {
  productIds?: string[];
  dryRun?: boolean;
};

async function loadLatestCatalogRows(latestScanAt: string) {
  const rows: SupplierCatalogRow[] = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    const page = await supabaseSelectPage<SupplierCatalogRow>("supplier_catalog_items", {
      select:
        "supplier_sku,product_name,brand,type,supplier_cost,buyer_active,seller_active,stock,unlimited_stock,last_seen_at",
      filters: {
        supplier_id: "eq.digiflazz",
        last_seen_at: `eq.${latestScanAt}`,
      },
      order: "supplier_sku.asc",
      limit: batchSize,
      offset,
    });

    rows.push(...page.data);
    offset += page.data.length;

    if (page.data.length === 0) break;
    if (page.count !== null && offset >= page.count) break;
    if (page.count === null && page.data.length < batchSize) break;
  }

  return rows;
}

function cleanProductLabel(productName: string, brand: string) {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutBrand = productName
    .replace(new RegExp(`^${escaped}\\s*[-–—:|]?\\s*`, "i"), "")
    .trim();
  return withoutBrand || productName.trim();
}

function roundUpToHundred(value: number) {
  return Math.ceil(Math.max(0, value) / 100) * 100;
}

function supplierItemIsAvailable(item: SupplierCatalogRow) {
  const stock = item.stock === null ? null : Number(item.stock);
  const hasStock = Boolean(item.unlimited_stock) || stock === null || stock > 0;
  return Boolean(item.buyer_active && item.seller_active && hasStock);
}

function canonicalNote(item: SupplierCatalogRow) {
  const value = item.type?.trim() ?? "";
  return value && value !== "-" ? value : null;
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: SyncBody = {};
  try {
    const raw = await request.text();
    body = raw ? (JSON.parse(raw) as SyncBody) : {};
  } catch {
    return Response.json({ error: "Request sinkronisasi tidak valid." }, { status: 400 });
  }

  const requestedProductIds = Array.from(
    new Set((body.productIds ?? []).map((value) => value.trim()).filter(Boolean)),
  );

  if (requestedProductIds.length > 100) {
    return Response.json({ error: "Maksimal 100 productId per sinkronisasi." }, { status: 400 });
  }

  const dryRun = body.dryRun === true;

  try {
    const [supplierRows, productRows, pricingRows, latestScanRows] = await Promise.all([
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku,supplier_cost,active,last_synced_at",
        filters: {
          supplier_id: "eq.digiflazz",
          supplier_sku: "not.is.null",
        },
      }),
      supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label,note,selling_price,reference_price,active",
      }),
      supabaseSelect<PricingRuleRow>("pricing_rules", {
        select: "minimum_nambah_profit",
        filters: { id: "eq.default" },
        limit: 1,
      }),
      supabaseSelect<{ last_seen_at: string }>("supplier_catalog_items", {
        select: "last_seen_at",
        filters: { supplier_id: "eq.digiflazz" },
        order: "last_seen_at.desc",
        limit: 1,
      }),
    ]);

    const latestScanAt = latestScanRows[0]?.last_seen_at ?? null;
    if (!latestScanAt) {
      return Response.json(
        {
          error:
            "Cache katalog Digiflazz belum tersedia. Jalankan Scan katalog Digiflazz terlebih dahulu.",
        },
        { status: 409 },
      );
    }

    const selectedRows = requestedProductIds.length
      ? supplierRows.filter((row) => requestedProductIds.includes(row.product_id))
      : supplierRows;

    if (selectedRows.length === 0) {
      return Response.json(
        {
          error: requestedProductIds.length
            ? "Tidak ada produk Digiflazz ter-mapping untuk productId yang diminta."
            : "Belum ada produk yang memiliki mapping SKU Digiflazz.",
        },
        { status: 404 },
      );
    }

    const catalogRows = await loadLatestCatalogRows(latestScanAt);
    const products = new Map(productRows.map((row) => [row.id, row]));
    const supplierItems = new Map(
      catalogRows.map((item) => [item.supplier_sku.toUpperCase(), item]),
    );
    const minimumNambahProfit = Number(pricingRows[0]?.minimum_nambah_profit ?? 500);
    const syncedAt = new Date().toISOString();

    const results = selectedRows.map((row) => {
      const item = supplierItems.get(row.supplier_sku.toUpperCase());
      const product = products.get(row.product_id);

      if (!item) {
        return {
          productId: row.product_id,
          gameId: product?.game_id ?? null,
          supplierSku: row.supplier_sku,
          status: "missing" as const,
          previousCost: Number(row.supplier_cost),
          currentCost: null,
          costChanged: false,
          activeBefore: row.active,
          active: false,
          productActiveBefore: product?.active ?? null,
          productLabelBefore: product?.label ?? null,
          productLabel: product?.label ?? null,
          labelChanged: false,
          sellingPriceBefore: product ? Number(product.selling_price) : null,
          sellingPrice: product ? Number(product.selling_price) : null,
          priceRaised: false,
          grossMarginBeforePaymentFees: null,
          minimumProfitBuffer: null,
          stock: null,
          unlimitedStock: false,
          buyerActive: false,
          sellerActive: false,
          stockAvailable: false,
          productMissing: !product,
        };
      }

      const currentCost = Number(item.supplier_cost);
      const active = supplierItemIsAvailable(item);
      const stock = item.stock === null ? null : Number(item.stock);
      const stockAvailable = Boolean(item.unlimited_stock) || stock === null || stock > 0;
      const canonicalLabel = cleanProductLabel(item.product_name, item.brand);
      const note = canonicalNote(item);
      const sellingPriceBefore = product ? Number(product.selling_price) : null;
      const minimumSellingPrice = roundUpToHundred(currentCost + minimumNambahProfit);
      const sellingPrice =
        sellingPriceBefore === null
          ? minimumSellingPrice
          : Math.max(sellingPriceBefore, minimumSellingPrice);
      const referencePrice = product
        ? Math.max(Number(product.reference_price), sellingPrice)
        : sellingPrice;
      const grossMargin = sellingPrice - currentCost;

      return {
        productId: row.product_id,
        gameId: product?.game_id ?? null,
        supplierSku: item.supplier_sku,
        status: "found" as const,
        previousCost: Number(row.supplier_cost),
        currentCost,
        costChanged: Number(row.supplier_cost) !== currentCost,
        activeBefore: row.active,
        active,
        productActiveBefore: product?.active ?? null,
        productLabelBefore: product?.label ?? null,
        productLabel: canonicalLabel,
        productNote: note,
        labelChanged: Boolean(product && product.label !== canonicalLabel),
        noteChanged: Boolean(product && product.note !== note),
        sellingPriceBefore,
        sellingPrice,
        referencePrice,
        priceRaised: sellingPriceBefore !== null && sellingPrice > sellingPriceBefore,
        grossMarginBeforePaymentFees: grossMargin,
        minimumProfitBuffer: grossMargin - minimumNambahProfit,
        stock,
        unlimitedStock: Boolean(item.unlimited_stock),
        buyerActive: Boolean(item.buyer_active),
        sellerActive: Boolean(item.seller_active),
        stockAvailable,
        productMissing: !product,
      };
    });

    const foundResults = results.filter((item) => item.status === "found");
    const missingResults = results.filter((item) => item.status === "missing");

    if (!dryRun) {
      await Promise.all([
        ...foundResults.map((result) =>
          supabaseUpdate(
            "supplier_products",
            {
              supplier_cost: result.currentCost,
              active: result.active,
              last_synced_at: syncedAt,
              updated_at: syncedAt,
            },
            {
              filters: {
                supplier_id: "eq.digiflazz",
                product_id: `eq.${result.productId}`,
              },
            },
          ),
        ),
        ...missingResults.map((result) =>
          supabaseUpdate(
            "supplier_products",
            {
              active: false,
              last_synced_at: syncedAt,
              updated_at: syncedAt,
            },
            {
              filters: {
                supplier_id: "eq.digiflazz",
                product_id: `eq.${result.productId}`,
              },
            },
          ),
        ),
      ]);

      await Promise.all([
        ...foundResults
          .filter((result) => !result.productMissing)
          .map((result) =>
            supabaseUpdate(
              "products",
              {
                label: result.productLabel,
                note: result.productNote,
                selling_price: result.sellingPrice,
                reference_price: result.referencePrice,
                active: result.active,
                updated_at: syncedAt,
              },
              { filters: { id: `eq.${result.productId}` } },
            ),
          ),
        ...missingResults
          .filter((result) => !result.productMissing)
          .map((result) =>
            supabaseUpdate(
              "products",
              { active: false, updated_at: syncedAt },
              { filters: { id: `eq.${result.productId}` } },
            ),
          ),
      ]);

      const gameIdsToReactivate = Array.from(
        new Set(
          foundResults
            .filter((result) => result.active && result.gameId)
            .map((result) => result.gameId as string),
        ),
      );

      await Promise.all(
        gameIdsToReactivate.map((gameId) =>
          supabaseUpdate(
            "games",
            { active: true, updated_at: syncedAt },
            { filters: { id: `eq.${gameId}` } },
          ),
        ),
      );

      if (foundResults.length > 0) {
        await supabaseInsert(
          "supplier_price_snapshots",
          foundResults.map((result) => ({
            supplier_id: "digiflazz",
            product_id: result.productId,
            supplier_sku: result.supplierSku,
            supplier_cost: result.currentCost,
            buyer_active: result.buyerActive,
            seller_active: result.sellerActive,
            stock: result.stock,
            unlimited_stock: result.unlimitedStock,
            synced_at: syncedAt,
          })),
        );
      }
    }

    return Response.json({
      mode: dryRun ? "dry-run" : "applied",
      source: "supplier_catalog_cache",
      catalogScanAt: latestScanAt,
      syncedAt: dryRun ? null : syncedAt,
      minimumNambahProfit,
      summary: {
        mapped: selectedRows.length,
        found: foundResults.length,
        missing: missingResults.length,
        costChanged: foundResults.filter((item) => item.costChanged).length,
        relabeled: foundResults.filter((item) => item.labelChanged || item.noteChanged).length,
        priceRaised: foundResults.filter((item) => item.priceRaised).length,
        activated: foundResults.filter(
          (item) => item.active && (!item.activeBefore || item.productActiveBefore === false),
        ).length,
        deactivated: results.filter(
          (item) => !item.active && (item.activeBefore || item.productActiveBefore === true),
        ).length,
        unavailable: foundResults.filter((item) => !item.active).length,
        outOfStock: foundResults.filter((item) => !item.stockAvailable).length,
        orphanedMappings: results.filter((item) => item.productMissing).length,
        thinBaseMargin: foundResults.filter((item) => item.minimumProfitBuffer < 0).length,
      },
      products: results,
    });
  } catch (error) {
    console.error("Digiflazz cached catalog sync failed", error);
    return Response.json(
      { error: "Sinkronisasi katalog dari cache Digiflazz gagal dijalankan." },
      { status: 502 },
    );
  }
}
