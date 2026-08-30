import {
  games as staticGames,
  paymentMethods as staticPaymentMethods,
  type Game,
  type PaymentMethod,
} from "@/lib/catalog";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  category: "game" | "voucher";
  accent: string;
  initials: string;
  requires_server: boolean;
  sort_order: number;
};

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  note: string | null;
  selling_price: number | string;
  reference_price: number | string;
  sort_order: number;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  detail: string;
  customer_fee_flat: number | string;
  customer_fee_percent: number | string;
  merchant_fee_flat: number | string;
  merchant_fee_percent: number | string;
  sort_order: number;
};

export type PublicCatalogResult = {
  games: Game[];
  paymentMethods: PaymentMethod[];
  source: "static" | "supabase";
};

export async function getPublicCatalog(): Promise<PublicCatalogResult> {
  if (!isSupabaseConfigured()) {
    return {
      games: staticGames,
      paymentMethods: staticPaymentMethods,
      source: "static",
    };
  }

  const [gameRows, productRows, paymentRows] = await Promise.all([
    supabaseSelect<GameRow>("games", {
      select: "id,name,short_name,category,accent,initials,requires_server,sort_order",
      filters: { active: "eq.true" },
      order: "sort_order.asc",
    }),
    supabaseSelect<ProductRow>("products", {
      select: "id,game_id,label,note,selling_price,reference_price,sort_order",
      filters: { active: "eq.true" },
      order: "sort_order.asc",
    }),
    supabaseSelect<PaymentMethodRow>("payment_methods", {
      select:
        "id,name,detail,customer_fee_flat,customer_fee_percent,merchant_fee_flat,merchant_fee_percent,sort_order",
      filters: { active: "eq.true" },
      order: "sort_order.asc",
    }),
  ]);

  const games: Game[] = gameRows
    .map((game) => ({
      id: game.id,
      name: game.name,
      shortName: game.short_name,
      category: game.category,
      accent: game.accent,
      initials: game.initials,
      requiresServer: game.requires_server,
      packages: productRows
        .filter((product) => product.game_id === game.id)
        .map((product) => ({
          id: product.id,
          label: product.label,
          ...(product.note ? { note: product.note } : {}),
          sellingPrice: Number(product.selling_price),
          referencePrice: Number(product.reference_price),
        })),
    }))
    .filter((game) => game.packages.length > 0);

  const paymentMethods: PaymentMethod[] = paymentRows.map((method) => ({
    id: method.id,
    name: method.name,
    detail: method.detail,
    customerFeeFlat: Number(method.customer_fee_flat),
    customerFeePercent: Number(method.customer_fee_percent),
    merchantFeeFlat: Number(method.merchant_fee_flat),
    merchantFeePercent: Number(method.merchant_fee_percent),
  }));

  if (games.length === 0 || paymentMethods.length === 0) {
    throw new Error("Supabase catalog is configured but contains no active catalog data.");
  }

  return { games, paymentMethods, source: "supabase" };
}
