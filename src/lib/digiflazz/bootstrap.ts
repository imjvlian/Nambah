import {
  getDigiflazzPrepaidPriceList,
  type DigiflazzPriceItem,
} from "@/lib/digiflazz/client";
import {
  supabaseSelect,
  supabaseSelectPage,
  supabaseUpsert,
} from "@/lib/supabase/server";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
};

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
};

type SupplierProductRow = {
  product_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
  active: boolean;
};

type SupplierCatalogRow = {
  supplier_sku: string;
  product_name: string;
  category: string;
  brand: string;
  type: string;
  seller_name: string;
  supplier_cost: number | string;
  buyer_active: boolean;
  seller_active: boolean;
  unlimited_stock: boolean;
  stock: number | string | null;
  multi: boolean;
  start_cut_off: string | null;
  end_cut_off: string | null;
  description: string | null;
  last_seen_at: string;
};

type Candidate = {
  sku: string;
  name: string;
  brand: string;
  type: string;
  cost: number;
  score: number;
};

const GAME_ALIASES: Record<string, string[]> = {
  "mobile-legends": ["mobile legends", "mlbb"],
  "free-fire": ["free fire"],
  "pubg-mobile": ["pubg mobile", "pubg"],
  valorant: ["valorant"],
  "honor-of-kings": ["honor of kings", "hok"],
  "genshin-impact": ["genshin impact", "genshin"],
  roblox: ["roblox"],
  "steam-wallet": ["steam wallet", "steam"],
};

const SPECIAL_KEYWORD_GROUPS: Array<{ needle: RegExp; keywords: string[] }> = [
  { needle: /weekly diamond pass/i, keywords: ["weekly", "pass"] },
  { needle: /weekly membership/i, keywords: ["weekly", "membership"] },
  { needle: /membership/i, keywords: ["membership"] },
  { needle: /welkin/i, keywords: ["welkin"] },
  { needle: /weekly card/i, keywords: ["weekly", "card"] },
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumbers(value: string) {
  const matches = value.match(/\d[\d.,]*/g) ?? [];
  return matches
    .map((part) => Number(part.replace(/[^0-9]/g, "")))
    .filter((number) => Number.isFinite(number));
}

function getSpecialKeywords(label: string) {
  return SPECIAL_KEYWORD_GROUPS.find((group) => group.needle.test(label))?.keywords ?? null;
}

function gameAliases(game: GameRow) {
  return Array.from(
    new Set([
      normalizeText(game.name),
      normalizeText(game.short_name),
      ...(GAME_ALIASES[game.id] ?? []),
    ]),
  ).filter(Boolean);
}

function scoreCandidate(game: GameRow, product: ProductRow, item: DigiflazzPriceItem) {
  if (!item.buyer_product_status || !item.seller_product_status) return null;

  const aliases = gameAliases(game);
  const brand = normalizeText(item.brand);
  const haystack = normalizeText(`${item.product_name} ${item.brand} ${item.type} ${item.desc}`);
  const brandMatch = aliases.some(
    (alias) => brand.includes(alias) || haystack.includes(alias),
  );

  if (!brandMatch) return null;

  let score = 60;
  const specialKeywords = getSpecialKeywords(product.label);

  if (specialKeywords) {
    const matched = specialKeywords.filter((keyword) => haystack.includes(keyword));
    if (matched.length === 0) return null;
    score += matched.length * 30;
  } else {
    const [denomination] = extractNumbers(product.label);
    if (!denomination) return null;

    const candidateNumbers = extractNumbers(`${item.product_name} ${item.desc}`);
    if (!candidateNumbers.includes(denomination)) return null;
    score += 60;
  }

  const labelWords = normalizeText(product.label)
    .split(" ")
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word));
  score += Math.min(20, labelWords.filter((word) => haystack.includes(word)).length * 5);

  return score;
}

function makeCandidate(game: GameRow, product: ProductRow, item: DigiflazzPriceItem): Candidate | null {
  const score = scoreCandidate(game, product, item);
  if (score === null) return null;

  return {
    sku: item.buyer_sku_code,
    name: item.product_name,
    brand: item.brand,
    type: item.type,
    cost: Number(item.price),
    score,
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadLatestCachedPriceList() {
  const [latest] = await supabaseSelect<{ last_seen_at: string }>("supplier_catalog_items", {
    select: "last_seen_at",
    filters: { supplier_id: "eq.digiflazz" },
    order: "last_seen_at.desc",
    limit: 1,
  });

  if (!latest?.last_seen_at) {
    throw new Error(
      "Cache katalog Digiflazz belum tersedia. Jalankan Scan katalog Digiflazz terlebih dahulu.",
    );
  }

  const rows: SupplierCatalogRow[] = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    const page = await supabaseSelectPage<SupplierCatalogRow>("supplier_catalog_items", {
      select:
        "supplier_sku,product_name,category,brand,type,seller_name,supplier_cost,buyer_active,seller_active,unlimited_stock,stock,multi,start_cut_off,end_cut_off,description,last_seen_at",
      filters: {
        supplier_id: "eq.digiflazz",
        last_seen_at: `eq.${latest.last_seen_at}`,
      },
      order: "supplier_sku.asc",
      limit: batchSize,
      offset,
    });

    rows.push(...page.data);
    offset += page.data.length;

    if (page.data.length === 0) break;
    if (page.count !== null && offset >= page.count) break;
    if (page.count === null && page.data.length < batchSize) break;
  }

  const priceList: DigiflazzPriceItem[] = rows.map((row) => ({
    product_name: row.product_name,
    category: row.category,
    brand: row.brand,
    type: row.type,
    seller_name: row.seller_name,
    price: Number(row.supplier_cost),
    buyer_sku_code: row.supplier_sku,
    buyer_product_status: Boolean(row.buyer_active),
    seller_product_status: Boolean(row.seller_active),
    unlimited_stock: Boolean(row.unlimited_stock),
    stock: row.stock === null ? 0 : Number(row.stock),
    multi: Boolean(row.multi),
    start_cut_off: row.start_cut_off ?? "",
    end_cut_off: row.end_cut_off ?? "",
    desc: row.description ?? "",
  }));

  return { priceList, catalogScanAt: latest.last_seen_at };
}

async function loadLivePriceListAndRefreshCache() {
  const priceList = await getDigiflazzPrepaidPriceList();
  const catalogScanAt = new Date().toISOString();

  const cacheRows = priceList.map((item) => ({
    supplier_id: "digiflazz",
    supplier_sku: item.buyer_sku_code,
    product_name: item.product_name,
    category: item.category,
    brand: item.brand,
    type: item.type,
    seller_name: item.seller_name,
    supplier_cost: Number(item.price),
    buyer_active: Boolean(item.buyer_product_status),
    seller_active: Boolean(item.seller_product_status),
    unlimited_stock: Boolean(item.unlimited_stock),
    stock: item.unlimited_stock ? null : Number(item.stock),
    multi: Boolean(item.multi),
    start_cut_off: item.start_cut_off || null,
    end_cut_off: item.end_cut_off || null,
    description: item.desc || null,
    last_seen_at: catalogScanAt,
    updated_at: catalogScanAt,
  }));

  for (const batch of chunk(cacheRows, 250)) {
    await supabaseUpsert("supplier_catalog_items", batch, {
      onConflict: "supplier_id,supplier_sku",
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }

  return { priceList, catalogScanAt };
}

export async function bootstrapDigiflazzCatalog(input?: {
  apply?: boolean;
  remap?: boolean;
}) {
  const apply = input?.apply === true;
  const remap = input?.remap === true;

  const catalog = apply
    ? await loadLatestCachedPriceList()
    : await loadLivePriceListAndRefreshCache();
  const priceList = catalog.priceList;
  const syncedAt = new Date().toISOString();

  const [games, products, supplierProducts] = await Promise.all([
    supabaseSelect<GameRow>("games", {
      select: "id,name,short_name",
      filters: { active: "eq.true" },
    }),
    supabaseSelect<ProductRow>("products", {
      select: "id,game_id,label",
      filters: { active: "eq.true" },
      order: "game_id.asc,sort_order.asc",
    }),
    supabaseSelect<SupplierProductRow>("supplier_products", {
      select: "product_id,supplier_sku,supplier_cost,active",
      filters: { supplier_id: "eq.digiflazz" },
    }),
  ]);

  const gamesById = new Map(games.map((game) => [game.id, game]));
  const mappingsByProduct = new Map(supplierProducts.map((row) => [row.product_id, row]));
  const priceListBySku = new Map(
    priceList.map((item) => [item.buyer_sku_code.toUpperCase(), item]),
  );
  const usedSkus = new Set(
    supplierProducts
      .map((row) => row.supplier_sku?.toUpperCase())
      .filter((sku): sku is string => Boolean(sku)),
  );

  const pendingUpserts: Array<Record<string, unknown>> = [];
  const results = products.map((product) => {
    const game = gamesById.get(product.game_id);
    const existing = mappingsByProduct.get(product.id);

    if (!game) {
      return {
        productId: product.id,
        label: product.label,
        gameId: product.game_id,
        state: "unmapped" as const,
        reason: "game-not-found",
        candidates: [] as Candidate[],
      };
    }

    if (existing?.supplier_sku && !remap) {
      const currentItem = priceListBySku.get(existing.supplier_sku.toUpperCase());
      const currentActive = Boolean(
        currentItem?.buyer_product_status && currentItem?.seller_product_status,
      );

      if (apply) {
        pendingUpserts.push({
          supplier_id: "digiflazz",
          product_id: product.id,
          supplier_sku: existing.supplier_sku,
          supplier_cost: currentItem ? Number(currentItem.price) : Number(existing.supplier_cost),
          active: currentItem ? currentActive : false,
          last_synced_at: syncedAt,
          updated_at: syncedAt,
        });
      }

      return {
        productId: product.id,
        label: product.label,
        gameId: product.game_id,
        state: "mapped" as const,
        mapping: {
          sku: existing.supplier_sku,
          cost: currentItem ? Number(currentItem.price) : Number(existing.supplier_cost),
          active: currentItem ? currentActive : false,
          foundInCurrentPriceList: Boolean(currentItem),
        },
        candidates: [] as Candidate[],
      };
    }

    const candidates = priceList
      .map((item) => makeCandidate(game, product, item))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((left, right) => right.score - left.score || left.cost - right.cost)
      .filter((candidate) => !usedSkus.has(candidate.sku.toUpperCase()));

    const best = candidates[0];
    const highConfidence = Boolean(best && best.score >= 100);

    if (best && highConfidence && apply) {
      usedSkus.add(best.sku.toUpperCase());
      pendingUpserts.push({
        supplier_id: "digiflazz",
        product_id: product.id,
        supplier_sku: best.sku,
        supplier_cost: best.cost,
        active: true,
        last_synced_at: syncedAt,
        updated_at: syncedAt,
      });
    }

    return {
      productId: product.id,
      label: product.label,
      gameId: product.game_id,
      state:
        best && highConfidence
          ? apply
            ? ("auto-mapped" as const)
            : ("suggested" as const)
          : ("unmapped" as const),
      suggestion: best ?? null,
      candidates: candidates.slice(0, 3),
    };
  });

  if (apply && pendingUpserts.length > 0) {
    await supabaseUpsert("supplier_products", pendingUpserts, {
      onConflict: "supplier_id,product_id",
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }

  const summary = {
    supplierCatalogItems: priceList.length,
    nambahProducts: products.length,
    alreadyMapped: results.filter((item) => item.state === "mapped").length,
    suggested: results.filter((item) => item.state === "suggested").length,
    autoMapped: results.filter((item) => item.state === "auto-mapped").length,
    unmapped: results.filter((item) => item.state === "unmapped").length,
  };

  return {
    mode: apply ? "applied" : "dry-run",
    source: apply ? "supplier_catalog_cache" : "digiflazz_live",
    remap,
    syncedAt,
    catalogScanAt: catalog.catalogScanAt,
    summary,
    products: results,
  };
}
