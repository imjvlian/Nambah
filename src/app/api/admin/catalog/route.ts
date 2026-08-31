import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  active: boolean;
  sort_order: number | string;
};

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  note: string | null;
  selling_price: number | string;
  reference_price: number | string;
  active: boolean;
  sort_order: number | string;
};

type SupplierProductRow = {
  product_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
  active: boolean;
  last_synced_at: string | null;
};

type SupplierBalanceRow = {
  balance: number | string;
  reserved_balance: number | string;
  checked_at: string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const [games, products, supplierProducts, balanceRows] = await Promise.all([
      supabaseSelect<GameRow>("games", {
        select: "id,name,short_name,active,sort_order",
        order: "sort_order.asc,name.asc",
      }),
      supabaseSelect<ProductRow>("products", {
        select:
          "id,game_id,label,note,selling_price,reference_price,active,sort_order",
        order: "game_id.asc,sort_order.asc,label.asc",
      }),
      supabaseSelect<SupplierProductRow>("supplier_products", {
        select: "product_id,supplier_sku,supplier_cost,active,last_synced_at",
        filters: { supplier_id: "eq.digiflazz" },
      }),
      supabaseSelect<SupplierBalanceRow>("supplier_balances", {
        select: "balance,reserved_balance,checked_at",
        filters: { supplier_id: "eq.digiflazz" },
        limit: 1,
      }),
    ]);

    const gamesById = new Map(games.map((game) => [game.id, game]));
    const supplierByProduct = new Map(
      supplierProducts.map((item) => [item.product_id, item]),
    );

    const catalog = products.map((product) => {
      const game = gamesById.get(product.game_id);
      const supplier = supplierByProduct.get(product.id);
      const mapped = Boolean(supplier?.supplier_sku);

      return {
        id: product.id,
        gameId: product.game_id,
        gameName: game?.name ?? product.game_id,
        gameShortName: game?.short_name ?? product.game_id,
        label: product.label,
        note: product.note,
        sellingPrice: Number(product.selling_price),
        referencePrice: Number(product.reference_price),
        active: product.active,
        sortOrder: Number(product.sort_order),
        supplier: {
          mapped,
          sku: supplier?.supplier_sku ?? null,
          cost: supplier ? Number(supplier.supplier_cost) : null,
          active: Boolean(supplier?.active),
          lastSyncedAt: supplier?.last_synced_at ?? null,
          ready: Boolean(mapped && supplier?.active),
        },
      };
    });

    const balance = balanceRows[0];
    const balanceValue = Number(balance?.balance ?? 0);
    const reservedBalance = Number(balance?.reserved_balance ?? 0);

    return Response.json({
      stats: {
        total: catalog.length,
        active: catalog.filter((item) => item.active).length,
        mapped: catalog.filter((item) => item.supplier.mapped).length,
        ready: catalog.filter((item) => item.active && item.supplier.ready).length,
        unmapped: catalog.filter((item) => !item.supplier.mapped).length,
      },
      balance: {
        balance: balanceValue,
        reservedBalance,
        availableBalance: Math.max(0, balanceValue - reservedBalance),
        checkedAt: balance?.checked_at ?? null,
      },
      games: games.map((game) => ({
        id: game.id,
        name: game.name,
        shortName: game.short_name,
        active: game.active,
      })),
      products: catalog,
    });
  } catch (error) {
    console.error("Admin catalog lookup failed", error);
    return Response.json(
      { error: "Katalog admin tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
