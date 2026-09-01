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

type SupplierAvailabilityRow = {
  product_id: string;
  active: boolean;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  detail: string;
  sort_order: number;
};

type OrderPopularityRow = {
  product_id: string;
};

export type ProductGroup = "hemat" | "populer" | "langganan" | "promo";
export type PublicPaymentMethod = Pick<PaymentMethod, "id" | "name" | "detail">;

export type PublicCatalogResult = {
  games: Game[];
  paymentMethods: PublicPaymentMethod[];
  source: "static" | "supabase";
};

type GroupablePackage = Game["packages"][number] & {
  groups?: ProductGroup[];
};

const SUBSCRIPTION_PATTERN =
  /(weekly|monthly|membership|member\b|pass\b|welkin|subscription|subscribe|langganan|mingguan|bulanan|7\s*(day|hari)|30\s*(day|hari))/i;

function withGameIcon(game: Game): Game {
  const icon = `/api/icons/game?v=store-1&name=${encodeURIComponent(game.name)}`;
  return {
    ...game,
    accent: `#171a16 url("${icon}") center / cover no-repeat`,
    initials: "",
  };
}

function discountPercent(item: GroupablePackage) {
  if (item.referencePrice <= item.sellingPrice || item.referencePrice <= 0) return 0;
  return ((item.referencePrice - item.sellingPrice) / item.referencePrice) * 100;
}

function enrichPackages(
  packages: GroupablePackage[],
  popularity: Map<string, number>,
): GroupablePackage[] {
  if (packages.length === 0) return packages;

  const rankedSavings = packages
    .map((item) => ({
      id: item.id,
      percent: discountPercent(item),
      saving: Math.max(0, item.referencePrice - item.sellingPrice),
      price: item.sellingPrice,
    }))
    .filter((item) => item.percent > 0)
    .sort(
      (left, right) =>
        right.percent - left.percent ||
        right.saving - left.saving ||
        left.price - right.price,
    );

  const bestSavingId = rankedSavings[0]?.id ?? null;

  const rankedPopularity = packages
    .map((item) => ({ id: item.id, count: popularity.get(item.id) ?? 0 }))
    .sort((left, right) => right.count - left.count);
  const bestPopularId = (rankedPopularity[0]?.count ?? 0) >= 2 ? rankedPopularity[0]!.id : null;

  return packages.map((item) => {
    const groups = new Set<ProductGroup>();
    const note = item.note ?? "";
    const searchable = `${item.label} ${note}`;

    if (item.referencePrice > item.sellingPrice) groups.add("promo");
    if (SUBSCRIPTION_PATTERN.test(searchable)) groups.add("langganan");
    if (/\bhemat\b/i.test(note) || item.id === bestSavingId) groups.add("hemat");
    if (/\bpopuler\b/i.test(note) || item.id === bestPopularId) groups.add("populer");

    return {
      ...item,
      ...(groups.size ? { groups: Array.from(groups) } : {}),
    };
  });
}

function enrichGame(game: Game, popularity: Map<string, number>): Game {
  return {
    ...game,
    packages: enrichPackages(game.packages as GroupablePackage[], popularity),
  };
}

export async function getPublicCatalog(): Promise<PublicCatalogResult> {
  if (!isSupabaseConfigured()) {
    const popularity = new Map<string, number>();
    return {
      games: staticGames.map((game) => withGameIcon(enrichGame(game, popularity))),
      paymentMethods: staticPaymentMethods.map(({ id, name, detail }) => ({
        id,
        name,
        detail,
      })),
      source: "static",
    };
  }

  const [gameRows, productRows, supplierAvailabilityRows, paymentRows, recentOrders] =
    await Promise.all([
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
      supabaseSelect<SupplierAvailabilityRow>("supplier_products", {
        select: "product_id,active",
        filters: {
          supplier_id: "eq.digiflazz",
          supplier_sku: "not.is.null",
        },
      }),
      supabaseSelect<PaymentMethodRow>("payment_methods", {
        select: "id,name,detail,sort_order",
        filters: { active: "eq.true" },
        order: "sort_order.asc",
      }),
      supabaseSelect<OrderPopularityRow>("orders", {
        select: "product_id",
        filters: { status: "in.(paid,processing,success)" },
        order: "created_at.desc",
        limit: 1000,
      }),
    ]);

  const supplierAvailability = new Map(
    supplierAvailabilityRows.map((row) => [row.product_id, Boolean(row.active)]),
  );

  const popularity = new Map<string, number>();
  for (const order of recentOrders) {
    popularity.set(order.product_id, (popularity.get(order.product_id) ?? 0) + 1);
  }

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
        .filter(
          (product) =>
            product.game_id === game.id &&
            (supplierAvailability.get(product.id) ?? true),
        )
        .map((product) => ({
          id: product.id,
          label: product.label,
          ...(product.note ? { note: product.note } : {}),
          sellingPrice: Number(product.selling_price),
          referencePrice: Number(product.reference_price),
        })),
    }))
    .filter((game) => game.packages.length > 0)
    .map((game) => withGameIcon(enrichGame(game, popularity)));

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
