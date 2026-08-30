import { authorizeAdminRequest } from "@/lib/admin-api";
import { getDigiflazzPrepaidPriceList } from "@/lib/digiflazz/client";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SupplierProductRow = {
  id: number;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
  active: boolean;
  last_synced_at: string | null;
};

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: { productId?: string; supplierSku?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request mapping tidak valid." }, { status: 400 });
  }

  const productId = body.productId?.trim() ?? "";
  const supplierSku = body.supplierSku?.trim() ?? "";

  if (!productId || !supplierSku) {
    return Response.json(
      { error: "productId dan supplierSku wajib diisi." },
      { status: 400 },
    );
  }

  try {
    const [existing] = await supabaseSelect<SupplierProductRow>("supplier_products", {
      select: "id,supplier_id,product_id,supplier_sku,supplier_cost,active,last_synced_at",
      filters: {
        supplier_id: "eq.digiflazz",
        product_id: `eq.${productId}`,
      },
      limit: 1,
    });

    if (!existing) {
      return Response.json(
        { error: "Produk supplier Digiflazz tidak ditemukan di database." },
        { status: 404 },
      );
    }

    const priceList = await getDigiflazzPrepaidPriceList({ code: supplierSku });
    const item = priceList.find(
      (entry) => entry.buyer_sku_code.toUpperCase() === supplierSku.toUpperCase(),
    );

    if (!item) {
      return Response.json(
        { error: "SKU tidak ditemukan pada price list Digiflazz." },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();
    const active = Boolean(item.buyer_product_status && item.seller_product_status);
    const [updated] = await supabaseUpdate<SupplierProductRow>(
      "supplier_products",
      {
        supplier_sku: item.buyer_sku_code,
        supplier_cost: Number(item.price),
        active,
        last_synced_at: now,
        updated_at: now,
      },
      {
        filters: {
          supplier_id: "eq.digiflazz",
          product_id: `eq.${productId}`,
        },
      },
    );

    if (!updated) {
      return Response.json({ error: "Mapping SKU gagal disimpan." }, { status: 500 });
    }

    return Response.json({
      mapping: {
        productId,
        supplierSku: item.buyer_sku_code,
        supplierName: item.product_name,
        brand: item.brand,
        category: item.category,
        cost: Number(item.price),
        active,
        lastSyncedAt: now,
      },
    });
  } catch (error) {
    console.error("Digiflazz SKU mapping failed", error);
    return Response.json(
      { error: "Gagal menyimpan mapping Digiflazz." },
      { status: 502 },
    );
  }
}
