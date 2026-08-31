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
  sort_order: number;
};

export type PublicPaymentMethod = Pick<PaymentMethod, "id" | "name" | "detail">;

export type PublicCatalogResult = {
  games: Game[];
  paymentMethods: PublicPaymentMethod[];
  source: "static" | "supabase";
};

function withGameIcon(game: Game): Game {
  const icon = `/api/icons/game?name=${encodeURIComponent(game.name)}`;
  return {
    ...game,
    accent: `#171a16 url("${icon}") center / 68% 68% no-repeat`,
    initials: "",
  };
}

export async function getPublicCatalog(): Promise<PublicCatalogResult> {
  if (!isSupabaseConfigured()) {
    return {
      games: staticGames.map(withGameIcon),
      paymentMethods: staticPaymentMethods.map(({ id, name, detail }) => ({
        id,
        name,
        detail,
      })),
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
      select: "id,name,detail,sort_order",
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
    .filter((game) => game.packages.length > 0)
    .map(withGameIcon);

  const paymentMethods: PublicPaymentMethod[] = paymentRows.map((method) => ({
    id: method.id,
    name: method.name,
    detail: method.detail,
  }));

  if (games.length === 0 || paymentMethods.length === 0) {
    throw new Error("Supabase catalog is configured but contains no active catalog data.");
  }

  return { games, paymentMethods, source: "supabase" };
}
