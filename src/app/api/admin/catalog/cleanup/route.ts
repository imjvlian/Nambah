import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";

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

type GameRow = {
  id: string;
  name: string;
  active: boolean;
};

type CleanupBody = {
  dryRun?: boolean;
};

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

  let body: CleanupBody = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as CleanupBody;
  } catch {
    return Response.json({ error: "Request clean katalog tidak valid." }, { status: 400 });
  }

  const dryRun = body.dryRun !== false;

  try {
    const [products, supplierProducts, games] = await Promise.all([
      supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label,active",
        order: "game_id.asc,sort_order.asc,label.asc",
      }),
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku",
      }),
      supabaseSelect<GameRow>("games", {
        select: "id,name,active",
        order: "sort_order.asc,name.asc",
      }),
    ]);

    const mappedProductIds = new Set(
      supplierProducts
        .filter((row) => Boolean(row.supplier_sku?.trim()))
        .map((row) => row.product_id),
    );

    const orphanProducts = products.filter((product) => !mappedProductIds.has(product.id));
    const activeOrphans = orphanProducts.filter((product) => product.active);
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
      },
      preview: {
        products: orphanProducts.slice(0, 20).map((product) => ({
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
