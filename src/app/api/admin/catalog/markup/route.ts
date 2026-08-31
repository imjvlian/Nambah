import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  selling_price: number | string;
  reference_price: number | string;
  active: boolean;
};

type SupplierProductRow = {
  product_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
  active: boolean;
};

type PricingRuleRow = {
  minimum_nambah_profit: number | string;
};

type MarkupScope = "ready" | "active-mapped" | "mapped";

type MarkupBody = {
  dryRun?: boolean;
  sellingMarkupPercent?: number;
  referenceMarkupPercent?: number;
  gameId?: string | null;
  scope?: MarkupScope;
};

function validPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 500;
}

function roundUpToHundred(value: number) {
  return Math.ceil(Math.max(0, value) / 100) * 100;
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: MarkupBody;
  try {
    body = (await request.json()) as MarkupBody;
  } catch {
    return Response.json({ error: "Request auto mark-up tidak valid." }, { status: 400 });
  }

  const dryRun = body.dryRun !== false;
  const sellingMarkupPercent = body.sellingMarkupPercent ?? 5;
  const referenceMarkupPercent = body.referenceMarkupPercent ?? 10;
  const gameId = body.gameId?.trim() || null;
  const scope: MarkupScope = body.scope ?? "ready";

  if (!validPercent(sellingMarkupPercent) || !validPercent(referenceMarkupPercent)) {
    return Response.json(
      { error: "Mark-up harus berupa angka 0 sampai 500 persen." },
      { status: 400 },
    );
  }

  if (!["ready", "active-mapped", "mapped"].includes(scope)) {
    return Response.json({ error: "Scope auto mark-up tidak valid." }, { status: 400 });
  }

  try {
    const [products, supplierProducts, pricingRules] = await Promise.all([
      supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label,selling_price,reference_price,active",
        order: "game_id.asc,sort_order.asc,label.asc",
      }),
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku,supplier_cost,active",
        filters: { supplier_id: "eq.digiflazz", supplier_sku: "not.is.null" },
      }),
      supabaseSelect<PricingRuleRow>("pricing_rules", {
        select: "minimum_nambah_profit",
        filters: { id: "eq.default" },
        limit: 1,
      }),
    ]);

    const minimumProfit = Math.max(0, Number(pricingRules[0]?.minimum_nambah_profit ?? 500));
    const supplierByProduct = new Map(supplierProducts.map((row) => [row.product_id, row]));

    const changes = products
      .filter((product) => {
        const supplier = supplierByProduct.get(product.id);
        if (!supplier?.supplier_sku) return false;
        if (gameId && product.game_id !== gameId) return false;
        if (scope === "ready") return product.active && supplier.active;
        if (scope === "active-mapped") return product.active;
        return true;
      })
      .map((product) => {
        const supplier = supplierByProduct.get(product.id)!;
        const cost = Number(supplier.supplier_cost);
        if (!Number.isFinite(cost) || cost < 0) return null;

        const percentagePrice = roundUpToHundred(cost * (1 + sellingMarkupPercent / 100));
        const minimumSafePrice = roundUpToHundred(cost + minimumProfit);
        const sellingPrice = Math.max(100, percentagePrice, minimumSafePrice);
        const referencePrice = Math.max(
          sellingPrice,
          roundUpToHundred(sellingPrice * (1 + referenceMarkupPercent / 100)),
        );

        return {
          productId: product.id,
          gameId: product.game_id,
          label: product.label,
          supplierSku: supplier.supplier_sku,
          supplierCost: cost,
          oldSellingPrice: Number(product.selling_price),
          oldReferencePrice: Number(product.reference_price),
          sellingPrice,
          referencePrice,
          changed:
            Number(product.selling_price) !== sellingPrice ||
            Number(product.reference_price) !== referencePrice,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const changed = changes.filter((item) => item.changed);

    if (!dryRun && changed.length > 0) {
      const now = new Date().toISOString();
      for (const batch of chunk(changed, 25)) {
        await Promise.all(
          batch.map((item) =>
            supabaseUpdate(
              "products",
              {
                selling_price: item.sellingPrice,
                reference_price: item.referencePrice,
                updated_at: now,
              },
              { filters: { id: `eq.${item.productId}` } },
            ),
          ),
        );
      }
    }

    return Response.json({
      mode: dryRun ? "preview" : "applied",
      rules: {
        sellingMarkupPercent,
        referenceMarkupPercent,
        minimumProfit,
        gameId,
        scope,
        rounding: 100,
      },
      summary: {
        eligible: changes.length,
        changed: changed.length,
        unchanged: changes.length - changed.length,
      },
      preview: changes.slice(0, 12),
    });
  } catch (error) {
    console.error("Admin auto markup failed", error);
    return Response.json({ error: "Auto mark-up harga gagal dijalankan." }, { status: 502 });
  }
}
