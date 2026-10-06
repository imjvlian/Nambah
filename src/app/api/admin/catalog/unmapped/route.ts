import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { supabaseDelete, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  active: boolean;
};

type SupplierProductRow = {
  product_id: string;
  supplier_sku: string | null;
};

type DeleteBody = {
  productIds?: string[];
  dryRun?: boolean;
};

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/**
 * Hapus permanen produk katalog yang tidak terhubung ke SKU supplier.
 *
 * Produk yang sudah punya riwayat order TIDAK PERNAH dihapus — orders.product_id
 * adalah jejak audit dan tidak ber-cascade. Produk seperti itu dikembalikan di
 * daftar `skipped` dan hanya boleh dinonaktifkan (lihat /api/admin/catalog/cleanup).
 */
export async function DELETE(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  let body: DeleteBody = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as DeleteBody;
  } catch {
    return Response.json({ error: "Request hapus katalog tidak valid." }, { status: 400 });
  }

  const dryRun = body.dryRun !== false;
  const requestedIds = Array.isArray(body.productIds)
    ? body.productIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 500)
    : null;

  try {
    const [products, supplierProducts] = await Promise.all([
      supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label,active",
        order: "game_id.asc,sort_order.asc,label.asc",
      }),
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku",
      }),
    ]);

    const mappedProductIds = new Set(
      supplierProducts
        .filter((row) => Boolean(row.supplier_sku?.trim()))
        .map((row) => row.product_id),
    );

    let candidates = products.filter((product) => !mappedProductIds.has(product.id));
    if (requestedIds) {
      const wanted = new Set(requestedIds);
      // Hanya produk yang memang unmapped — ID mapped yang diselipkan klien
      // diam-diam diabaikan supaya endpoint ini tidak bisa dipakai menghapus
      // produk yang masih bisa dipenuhi supplier.
      candidates = candidates.filter((product) => wanted.has(product.id));
    }

    if (candidates.length === 0) {
      return Response.json({
        mode: dryRun ? "preview" : "applied",
        summary: { candidates: 0, deletable: 0, skipped: 0, deleted: 0 },
        deletable: [],
        skipped: [],
      });
    }

    // Produk bersejarah (ada order) tidak boleh dihapus — pisahkan ke skipped.
    const productsWithOrders = new Set<string>();
    for (const batch of chunk(candidates, 25)) {
      const idList = batch.map((product) => product.id).join(",");
      const orderRefs = await supabaseSelect<{ product_id: string }>("orders", {
        select: "product_id",
        filters: { product_id: `in.(${idList})` },
        limit: 1000,
      });
      for (const ref of orderRefs) productsWithOrders.add(ref.product_id);
    }

    const deletable = candidates.filter((product) => !productsWithOrders.has(product.id));
    const skipped = candidates
      .filter((product) => productsWithOrders.has(product.id))
      .map((product) => ({
        id: product.id,
        gameId: product.game_id,
        label: product.label,
        reason: "Memiliki riwayat order — nonaktifkan saja, jangan dihapus.",
      }));

    let deleted = 0;
    if (!dryRun && deletable.length > 0) {
      for (const batch of chunk(deletable, 25)) {
        const idList = batch.map((product) => product.id).join(",");
        // Child rows dulu (juga ber-cascade, tapi eksplisit supaya tahan drift skema).
        await supabaseDelete("promotion_products", {
          filters: { product_id: `in.(${idList})` },
        });
        await supabaseDelete("supplier_products", {
          filters: { product_id: `in.(${idList})` },
        });
        const removed = await supabaseDelete<{ id: string }>("products", {
          filters: { id: `in.(${idList})` },
        });
        deleted += removed.length;
      }

      await auditAdminAction(request, {
        action: "catalog.unmapped.delete",
        targetType: "catalog",
        metadata: {
          deleted,
          skipped: skipped.length,
          productIds: deletable.slice(0, 50).map((product) => product.id),
        },
      });
    }

    return Response.json({
      mode: dryRun ? "preview" : "applied",
      summary: {
        candidates: candidates.length,
        deletable: deletable.length,
        skipped: skipped.length,
        deleted,
      },
      deletable: deletable.slice(0, 20).map((product) => ({
        id: product.id,
        gameId: product.game_id,
        label: product.label,
      })),
      skipped: skipped.slice(0, 20),
    });
  } catch (error) {
    console.error("Admin catalog unmapped delete failed", error);
    return Response.json(
      { error: "Hapus produk tanpa mapping gagal dijalankan." },
      { status: 502 },
    );
  }
}
