import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelectAll, supabaseUpdate } from "@/lib/supabase/server";

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
  active: boolean;
};

type GameRow = {
  id: string;
  name: string;
  active: boolean;
};

type CleanupBody = {
  dryRun?: boolean;
  /**
   * Sekalian nonaktifkan produk AKTIF yang tidak punya mapping aktif
   * dari supplier mana pun (SKU-nya mati di semua supplier).
   *
   * Tanpa flag ini produk begitu hanya dilaporkan - perilaku lama.
   * Dua langkah disengaja: lihat daftarnya (preview) dulu, baru
   * putuskan menyembunyikan.
   */
  includeUnavailable?: boolean;
};

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  let body: CleanupBody = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as CleanupBody;
  } catch {
    return Response.json({ error: "Request clean katalog tidak valid." }, { status: 400 });
  }

  const dryRun = body.dryRun !== false;
  const includeUnavailable = body.includeUnavailable === true;

  try {
    // products & supplier_products melewati 1000 baris. Kalau dipotong, produk
    // yang mapping-nya ada di baris 1001+ akan terlihat "orphan" lalu ikut
    // dinonaktifkan — padahal produk itu valid.
    const [products, supplierProducts, games] = await Promise.all([
      supabaseSelectAll<ProductRow>("products", {
        select: "id,game_id,label,active",
        order: "game_id.asc,sort_order.asc,label.asc",
      }),
      supabaseSelectAll<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku,active",
        filters: { supplier_id: "in.(digiflazz,melostore)" },
      }),
      supabaseSelectAll<GameRow>("games", {
        select: "id,name,active",
        order: "sort_order.asc,name.asc",
      }),
    ]);

    // Mapping dari KEDUA supplier - produk Melostore-saja adalah sah, bukan orphan.
    const mappedProductIds = new Set(
      supplierProducts
        .filter((row) => Boolean(row.supplier_sku?.trim()))
        .map((row) => row.product_id),
    );
    // Punya mapping aktif dari supplier mana pun = masih bisa dibeli.
    const activeMappingProductIds = new Set(
      supplierProducts
        .filter((row) => Boolean(row.supplier_sku?.trim()) && row.active === true)
        .map((row) => row.product_id),
    );

    const orphanProducts = products.filter((product) => !mappedProductIds.has(product.id));
    const activeOrphans = orphanProducts.filter((product) => product.active);
    /*
     * "Mati": terpetakan, tapi SEMUA mapping-nya nonaktif - SKU-nya
     * sudah dihapus/dijeda di semua supplier. Etalase sudah
     * menyembunyikannya; di panel admin barisnya masih "aktif" dan
     * menutupi produk yang benar-benar hidup.
     */
    const unavailableProducts = products.filter(
      (product) =>
        mappedProductIds.has(product.id) && !activeMappingProductIds.has(product.id),
    );
    const activeUnavailable = unavailableProducts.filter((product) => product.active);
    const activeMappedByGame = new Set(
      products
        .filter((product) => product.active && mappedProductIds.has(product.id))
        .map((product) => product.game_id),
    );
    const gamesToDisable = games.filter(
      (game) => game.active && !activeMappedByGame.has(game.id),
    );

    if (!dryRun) {
      const now = new Date().toISOString();

      for (const batch of chunk(activeOrphans, 25)) {
        await Promise.all(
          batch.map((product) =>
            supabaseUpdate(
              "products",
              { active: false, updated_at: now },
              { filters: { id: `eq.${product.id}` } },
            ),
          ),
        );
      }

      /*
       * Nonaktifkan produk mati - hanya saat diminta sengaja
       * (includeUnavailable). Reversibel: kalau SKU supplier hidup
       * kembali, sinkron Digiflazz maupun sinkron mapping Melostore
       * mengaktifkan ulang produk itu otomatis.
       */
      if (includeUnavailable) {
        for (const batch of chunk(activeUnavailable, 25)) {
          await Promise.all(
            batch.map((product) =>
              supabaseUpdate(
                "products",
                { active: false, updated_at: now },
                { filters: { id: `eq.${product.id}` } },
              ),
            ),
          );
        }
      }

      for (const batch of chunk(gamesToDisable, 25)) {
        await Promise.all(
          batch.map((game) =>
            supabaseUpdate(
              "games",
              { active: false, updated_at: now },
              { filters: { id: `eq.${game.id}` } },
            ),
          ),
        );
      }
    }

    return Response.json({
      mode: dryRun ? "preview" : "applied",
      summary: {
        orphanProducts: orphanProducts.length,
        activeOrphans: activeOrphans.length,
        alreadyHidden: orphanProducts.length - activeOrphans.length,
        gamesToDisable: gamesToDisable.length,
        unavailableProducts: unavailableProducts.length,
        activeUnavailable: activeUnavailable.length,
        unavailableDeactivated:
          !dryRun && includeUnavailable ? activeUnavailable.length : 0,
      },
      preview: {
        products: orphanProducts.slice(0, 20).map((product) => ({
          id: product.id,
          gameId: product.game_id,
          label: product.label,
          active: product.active,
        })),
        unavailable: unavailableProducts.slice(0, 20).map((product) => ({
          id: product.id,
          gameId: product.game_id,
          label: product.label,
          active: product.active,
        })),
        games: gamesToDisable.slice(0, 20).map((game) => ({
          id: game.id,
          name: game.name,
        })),
      },
    });
  } catch (error) {
    console.error("Admin catalog cleanup failed", error);
    return Response.json({ error: "Clean produk tanpa mapping gagal dijalankan." }, { status: 502 });
  }
}
