import {
  games as staticGames,
  paymentMethods as staticPaymentMethods,
  type CatalogCategory,
  type Game,
  type PaymentMethod,
} from "@/lib/catalog";
import { isSupabaseConfigured, supabaseSelect, supabaseSelectAll } from "@/lib/supabase/server";
import { gameDisplayNames } from "@/lib/game-display-name";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  category: CatalogCategory;
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
  supplier_cost: number | string;
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

/** Jumlah produk yang ditandai "Best Deals" per halaman produk. */
export const TOP_MARGIN_LIMIT = 5;

/**
 * Produk bantu (cek username / cek nama) bukan barang yang dibeli, tapi tetap
 * punya harga jual sehingga marjinnya menyesatkan (mendekati 100%). Item seperti
 * ini tidak layak jadi "Best Deals".
 */
const NON_PURCHASABLE_PATTERN =
  /\b(cek|check|verifikasi|validasi)\s+(username|nama|akun|user)\b/i;

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

/**
 * Margin rupiah per produk dihitung di server dari harga jual dan modal
 * supplier. Nilainya hanya dipakai untuk peringkat "Best Deals" — angka
 * modal tidak pernah masuk ke bundle pelanggan (lihat PublicCatalogResult).
 *
 * Urutannya memakai selisih rupiah, bukan persentase: pada produk dengan margin
 * persen yang seragam, nominal besar justru menyumbang rupiah paling banyak.
 */
export function topMarginPackageIds(
  packages: Array<{ id: string; label: string; sellingPrice: number }>,
  costByProductId: Map<string, number>,
  limit = TOP_MARGIN_LIMIT,
): string[] {
  return packages
    .filter((item) => !NON_PURCHASABLE_PATTERN.test(item.label))
    .map((item) => {
      const cost = costByProductId.get(item.id);
      if (cost === undefined) return null;
      if (!(item.sellingPrice > 0) || !(cost > 0)) return null;
      return { id: item.id, margin: item.sellingPrice - cost };
    })
    .filter((item): item is { id: string; margin: number } => item !== null)
    .sort(
      (left, right) => right.margin - left.margin || left.id.localeCompare(right.id),
    )
    .slice(0, limit)
    .map((item) => item.id);
}

function enrichPackages(
  packages: GroupablePackage[],
  popularity: Map<string, number>,
  topMarginIds: ReadonlySet<string> = new Set(),
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
  const packages = game.packages as GroupablePackage[];
  const popularPackageIds = game.popularPackageIds ?? [];

  return {
    ...game,
    ...(popularPackageIds.length ? { popularPackageIds } : {}),
    packages: enrichPackages(
      packages,
      popularity,
      new Set(popularPackageIds),
    ),
  };
}

function getStaticCatalog(): PublicCatalogResult {
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

function isTransientSupabaseJwtError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /PGRST303|JWT issued at future|JWT[^\n]*future|JWT not yet valid/i.test(message);
}

/**
 * Status ketersediaan + modal supplier. Kolom supplier_cost tidak selalu bisa
 * dibaca (kebijakan kolom / RLS), jadi ada fallback tanpa kolom tersebut:
 * katalog tetap jalan, hanya peringkat "Best Deals" yang kosong.
 */
async function fetchSupplierAvailability(): Promise<SupplierAvailabilityRow[]> {
  const filters = {
    supplier_id: "eq.digiflazz",
    supplier_sku: "not.is.null",
  };

  try {
    return await supabaseSelectAll<SupplierAvailabilityRow>("supplier_products", {
      select: "product_id,active,supplier_cost",
      filters,
    });
  } catch (error) {
    console.warn(
      "supplier_cost tidak terbaca; peringkat produk populer dilewati.",
      error instanceof Error ? error.message : String(error),
    );
    return supabaseSelectAll<SupplierAvailabilityRow>("supplier_products", {
      select: "product_id,active",
      filters,
    });
  }
}

export async function getPublicCatalog(): Promise<PublicCatalogResult> {
  if (!isSupabaseConfigured()) return getStaticCatalog();

  let gameRows: GameRow[];
  let productRows: ProductRow[];
  let paymentRows: PaymentMethodRow[];
  let recentOrders: OrderPopularityRow[];

  try {
    // products & games bisa melewati 1000 baris -> WAJIB supabaseSelectAll.
    // Dengan supabaseSelect biasa, PostgREST memotong di 1000 baris sehingga
    // hundreds produk hilang dari etalase tanpa jejak.
    [gameRows, productRows, paymentRows, recentOrders] = await Promise.all([
      supabaseSelectAll<GameRow>("games", {
        select: "id,name,short_name,category,accent,initials,requires_server,sort_order",
        filters: { active: "eq.true" },
        order: "sort_order.asc",
      }),
      supabaseSelectAll<ProductRow>("products", {
        select: "id,game_id,label,note,selling_price,reference_price,sort_order",
        filters: { active: "eq.true" },
        order: "sort_order.asc",
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
  } catch (error) {
    if (!isTransientSupabaseJwtError(error)) throw error;

    console.warn(
      "Supabase catalog read hit a temporary JWT validation error; using static catalog fallback.",
      error instanceof Error ? error.message : String(error),
    );
    return getStaticCatalog();
  }

  const supplierAvailabilityRows = await fetchSupplierAvailability();

  const supplierAvailability = new Map(
    supplierAvailabilityRows.map((row) => [row.product_id, Boolean(row.active)]),
  );

  /**
   * Aturan etalase: produk hanya tampil kalau benar-benar bisa dibeli dari
   * Digiflazz — punya baris mapping dengan SKU terisi, dan mapping-nya aktif
   * (SKU masih ada & stoknya tersedia di Digiflazz).
   *
   * `?? true` yang lama membuat produk tanpa mapping tetap tampil, lalu gagal
   * saat fulfillment dengan pesan "SKU belum mapped". Sekarang produk seperti
   * itu langsung disembunyikan dari etalase.
   */
  function isPurchasableFromSupplier(productId: string) {
    return supplierAvailability.get(productId) === true;
  }

  // Modal supplier hanya dipakai di server untuk peringkat margin; tidak
  // pernah ikut ke PublicCatalogResult yang dikirim ke klien.
  const supplierCostByProductId = new Map<string, number>();
  for (const row of supplierAvailabilityRows) {
    const cost = Number(row.supplier_cost);
    if (Number.isFinite(cost) && cost > 0) supplierCostByProductId.set(row.product_id, cost);
  }

  const popularity = new Map<string, number>();
  for (const order of recentOrders) {
    popularity.set(order.product_id, (popularity.get(order.product_id) ?? 0) + 1);
  }

  const games: Game[] = gameRows
    .map((game) => {
      const packages = productRows
        .filter(
          (product) =>
            product.game_id === game.id &&
            isPurchasableFromSupplier(product.id),
        )
        .map((product) => ({
          id: product.id,
          label: product.label,
          ...(product.note ? { note: product.note } : {}),
          sellingPrice: Number(product.selling_price),
          referencePrice: Number(product.reference_price),
        }));

      const display = gameDisplayNames(game.id, {
        name: game.name,
        shortName: game.short_name,
      });

      return {
        id: game.id,
        name: display.name,
        shortName: display.shortName,
        category: game.category,
        accent: game.accent,
        initials: game.initials,
        requiresServer: game.requires_server,
        packages,
        popularPackageIds: topMarginPackageIds(packages, supplierCostByProductId),
      };
    })
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
