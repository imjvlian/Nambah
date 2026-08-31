import { authorizeAdminRequest } from "@/lib/admin-api";
import { getDigiflazzPrepaidPriceList } from "@/lib/digiflazz/client";
import {
  supabaseInsert,
  supabaseSelect,
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
  label: string;
  selling_price: number | string;
};

type PricingRuleRow = {
  minimum_nambah_profit: number | string;
};

type SyncBody = {
  productIds?: string[];
  dryRun?: boolean;
};

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
    const [supplierRows, productRows, pricingRows, priceList] = await Promise.all([
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku,supplier_cost,active,last_synced_at",
        filters: {
          supplier_id: "eq.digiflazz",
          supplier_sku: "not.is.null",
        },
      }),
      supabaseSelect<ProductRow>("products", {
        select: "id,label,selling_price",
        filters: { active: "eq.true" },
      }),
      supabaseSelect<PricingRuleRow>("pricing_rules", {
        select: "minimum_nambah_profit",
        filters: { id: "eq.default" },
        limit: 1,
      }),
      getDigiflazzPrepaidPriceList(),
    ]);

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

    const products = new Map(productRows.map((row) => [row.id, row]));
    const supplierItems = new Map(
      priceList.map((item) => [item.buyer_sku_code.toUpperCase(), item]),
    );
    const minimumNambahProfit = Number(pricingRows[0]?.minimum_nambah_profit ?? 500);
    const syncedAt = new Date().toISOString();

    const results = selectedRows.map((row) => {
      const item = supplierItems.get(row.supplier_sku.toUpperCase());
      const product = products.get(row.product_id);

      if (!item) {
        return {
          productId: row.product_id,
          supplierSku: row.supplier_sku,
          status: "missing" as const,
          previousCost: Number(row.supplier_cost),
          currentCost: null,
          costChanged: false,
          active: row.active,
          productLabel: product?.label ?? null,
          sellingPrice: product ? Number(product.selling_price) : null,
          grossMarginBeforePaymentFees: null,
          minimumProfitBuffer: null,
        };
      }

      const currentCost = Number(item.price);
      const active = Boolean(item.buyer_product_status && item.seller_product_status);
      const sellingPrice = product ? Number(product.selling_price) : null;
      const grossMargin = sellingPrice === null ? null : sellingPrice - currentCost;

      return {
        productId: row.product_id,
        supplierSku: item.buyer_sku_code,
        status: "found" as const,
        previousCost: Number(row.supplier_cost),
        currentCost,
        costChanged: Number(row.supplier_cost) !== currentCost,
        active,
        productLabel: product?.label ?? null,
        sellingPrice,
        grossMarginBeforePaymentFees: grossMargin,
        minimumProfitBuffer:
          grossMargin === null ? null : grossMargin - minimumNambahProfit,
        stock: Number.isFinite(Number(item.stock)) ? Number(item.stock) : null,
        unlimitedStock: Boolean(item.unlimited_stock),
        buyerActive: Boolean(item.buyer_product_status),
        sellerActive: Boolean(item.seller_product_status),
      };
    });

    const foundResults = results.filter((item) => item.status === "found");

    if (!dryRun && foundResults.length > 0) {
      await Promise.all(
        foundResults.map((result) =>
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
      );

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

    return Response.json({
      mode: dryRun ? "dry-run" : "applied",
      syncedAt: dryRun ? null : syncedAt,
      minimumNambahProfit,
      summary: {
        mapped: selectedRows.length,
        found: foundResults.length,
        missing: results.filter((item) => item.status === "missing").length,
        costChanged: foundResults.filter((item) => item.costChanged).length,
        inactive: foundResults.filter((item) => !item.active).length,
        thinBaseMargin: foundResults.filter(
          (item) => item.minimumProfitBuffer !== null && item.minimumProfitBuffer < 0,
        ).length,
      },
      products: results,
    });
  } catch (error) {
    console.error("Digiflazz price sync failed", error);
    return Response.json(
      { error: "Sinkronisasi harga Digiflazz gagal dijalankan." },
      { status: 502 },
    );
  }
}
