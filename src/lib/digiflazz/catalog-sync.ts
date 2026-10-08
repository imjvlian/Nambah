import { getDigiflazzPrepaidPriceList } from "@/lib/digiflazz/client";
import {
  cleanProductLabel,
  makeProductId,
  minimumSellingPrice,
  resolveGame,
  type GameRow,
  type SupplierCatalogItem,
} from "@/lib/digiflazz/product-identity";
import {
  supabaseDelete,
  supabaseInsert,
  supabaseSelectAll,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";

/**
 * Sinkron penuh katalog Nambah dengan katalog Digiflazz.
 *
 * Berbeda dengan bootstrap (yang menebak lewat skor label), sinkron ini
 * bekerja persis pada supplier_sku:
 *  - SKU baru di Digiflazz  -> dibuatkan produk + mapping ke SKU itu
 *  - SKU sudah ada          -> harga modal & status aktif disegarkan
 *  - mapping ke SKU yang sudah hilang -> dimatikan, produk disembunyikan
 *
 * Dengan begitu etalase hanya berisi produk yang benar-benar bisa dibeli, dan
 * tidak ada pencocokan tebakan yang bisa tertukar varian.
 */

type CatalogRow = {
  supplier_sku: string;
  product_name: string;
  category: string;
  brand: string;
  type: string;
  supplier_cost: number | string;
  buyer_active: boolean;
  seller_active: boolean;
  last_seen_at: string;
};

type MappingRow = {
  product_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
  active: boolean;
};

type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  selling_price: number | string;
  reference_price: number | string;
  active: boolean;
};

export type CatalogSyncSummary = {
  catalogItems: number;
  catalogSource: "live" | "cache";
  catalogScanAt: string;
  staleWarning: string | null;
  productsCreated: number;
  mappingsCreated: number;
  costsRefreshed: number;
  pricesRaised: number;
  deactivatedMissingSku: number;
  productsRemoved: number;
  productsHidden: number;
  /** Mapping aktif yang diharapkan setelah sinkron = jumlah SKU di katalog. */
  expectedActiveMappings: number;
  gamesActivated: number;
  failures: string[];
};

const UPSERT_BATCH = 400;

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadCatalog(preferLive: boolean) {
  if (preferLive) {
    try {
      const priceList = await getDigiflazzPrepaidPriceList();
      const scannedAt = new Date().toISOString();

      for (const batch of chunk(
        priceList.map((item) => ({
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
          last_seen_at: scannedAt,
          updated_at: scannedAt,
        })),
        UPSERT_BATCH,
      )) {
        await supabaseUpsert("supplier_catalog_items", batch, {
          onConflict: "supplier_id,supplier_sku",
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      }

      return {
        items: priceList.map<SupplierCatalogItem>((item) => ({
          supplier_sku: item.buyer_sku_code,
          product_name: item.product_name,
          category: item.category,
          brand: item.brand,
          type: item.type,
          supplier_cost: Number(item.price),
          buyer_active: Boolean(item.buyer_product_status),
          seller_active: Boolean(item.seller_product_status),
        })),
        source: "live" as const,
        scannedAt,
      };
    } catch (error) {
      console.warn(
        "Live price-list Digiflazz gagal; memakai cache terakhir.",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const cached = await supabaseSelectAll<CatalogRow>("supplier_catalog_items", {
    select:
      "supplier_sku,product_name,category,brand,type,supplier_cost,buyer_active,seller_active,last_seen_at",
    filters: { supplier_id: "eq.digiflazz" },
    order: "last_seen_at.desc,supplier_sku.asc",
  });

  if (cached.length === 0) {
    throw new Error(
      "Katalog Digiflazz belum tersedia. Scan katalog dulu, lalu ulangi sinkron.",
    );
  }

  const scannedAt = cached[0]!.last_seen_at;
  // Hanya baris dari scan terakhir yang dianggap katalog terkini.
  const fresh = cached.filter((row) => row.last_seen_at === scannedAt);

  return {
    items: fresh.map<SupplierCatalogItem>((row) => ({
      supplier_sku: row.supplier_sku,
      product_name: row.product_name,
      category: row.category,
      brand: row.brand,
      type: row.type,
      supplier_cost: row.supplier_cost,
      buyer_active: row.buyer_active,
      seller_active: row.seller_active,
    })),
    source: "cache" as const,
    scannedAt,
  };
}

export type CatalogSyncPlan = {
  summary: CatalogSyncSummary;
  apply: () => Promise<CatalogSyncSummary>;
};

/**
 * Hitung rencana rekonsiliasi tanpa menulis apa pun. Semua tool sinkron
 * memakai fungsi ini supaya hasilnya selalu sama: katalog Nambah dicerminkan
 * dari katalog Digiflazz berdasarkan supplier_sku.
 */
export async function planCatalogSync(input?: {
  preferLive?: boolean;
}): Promise<CatalogSyncPlan> {
  const preferLive = input?.preferLive !== false;
  const now = new Date().toISOString();

  const catalog = await loadCatalog(preferLive);

  const [products, mappings, games, pricingRules] = await Promise.all([
    supabaseSelectAll<ProductRow>("products", {
      select: "id,game_id,label,selling_price,reference_price,active",
    }),
    supabaseSelectAll<MappingRow>("supplier_products", {
      select: "product_id,supplier_sku,supplier_cost,active",
      filters: { supplier_id: "eq.digiflazz" },
    }),
    supabaseSelectAll<GameRow>("games", {
      select:
        "id,name,short_name,category,accent,initials,requires_server,fulfillment_target_template,active",
    }),
    supabaseSelectAll<{ minimum_nambah_profit: number | string }>("pricing_rules", {
      select: "minimum_nambah_profit",
      filters: { id: "eq.default" },
    }),
  ]);

  const minimumProfit = Number(pricingRules[0]?.minimum_nambah_profit ?? 500);
  const productById = new Map(products.map((product) => [product.id, product]));
  const mappingBySku = new Map<string, MappingRow>();
  for (const mapping of mappings) {
    if (mapping.supplier_sku) mappingBySku.set(mapping.supplier_sku, mapping);
  }

  const knownGames = [...games];
  const gameIdsToActivate = new Set<string>();

  const catalogItems: SupplierCatalogItem[] = catalog.items;

  const newProducts: Array<Record<string, unknown>> = [];
  const newMappings: Array<Record<string, unknown>> = [];
  const newGames: Array<Record<string, unknown>> = [];
  const costUpdates: Array<Record<string, unknown>> = [];
  const priceUpdates: Array<Record<string, unknown>> = [];
  const gamesToActivate = new Set<string>();

  for (const item of catalogItems) {
    const cost = Number(item.supplier_cost);
    const skuAvailable = Boolean(item.buyer_active && item.seller_active);
    const productId = makeProductId(item.supplier_sku);
    const existingMapping = mappingBySku.get(item.supplier_sku);
    const existingProduct = productById.get(productId);

    if (existingProduct) {
      gameIdsToActivate.add(existingProduct.game_id);
    }

    // Kasus normal: produk + mapping sudah ada -> segarkan angka.
    if (existingMapping && existingProduct) {
      if (Number(existingMapping.supplier_cost) !== cost || existingMapping.active !== skuAvailable) {
        costUpdates.push({
          supplier_id: "digiflazz",
          product_id: existingProduct.id,
          supplier_sku: item.supplier_sku,
          supplier_cost: cost,
          active: skuAvailable,
          last_synced_at: now,
          updated_at: now,
        });
      }

      const floor = minimumSellingPrice(cost, minimumProfit);
      if (Number(existingProduct.selling_price) < floor) {
        priceUpdates.push({
          id: existingProduct.id,
          selling_price: floor,
          reference_price: Math.max(Number(existingProduct.reference_price), floor),
          updated_at: now,
        });
      }
      if (!existingProduct.active) {
        priceUpdates.push({ id: existingProduct.id, active: true, updated_at: now });
      }
      continue;
    }

    // SKU ini belum punya produk (atau produknya hilang) -> buat. Mapping
    // ditulis ulang agar tetap persis ke supplier_sku.
    const { game, create } = resolveGame(item, knownGames);
    if (create) {
      newGames.push({
        id: game.id,
        name: game.name,
        short_name: game.short_name,
        category: game.category,
        accent: game.accent,
        initials: game.initials,
        requires_server: game.requires_server,
        // Dari peta kurasi. Kalau null, game ini belum diverifikasi dan
        // readiness akan menandainya blocker — lebih baik daripada template
        // tebakan yang menghasilkan target salah ke supplier.
        fulfillment_target_template: game.fulfillment_target_template,
        active: true,
        sort_order: 1000,
        created_at: now,
        updated_at: now,
      });
      knownGames.push({ ...game, active: true });
    }
    gamesToActivate.add(game.id);

    const price = minimumSellingPrice(cost, minimumProfit);
    newProducts.push({
      id: productId,
      game_id: game.id,
      label: cleanProductLabel(item.product_name, item.brand),
      note: item.type && item.type !== "-" ? item.type : null,
      selling_price: price,
      reference_price: price,
      active: true,
      sort_order: Math.min(2_000_000_000, Math.max(0, Math.round(cost))),
      created_at: now,
      updated_at: now,
    });
    newMappings.push({
      supplier_id: "digiflazz",
      product_id: productId,
      supplier_sku: item.supplier_sku,
      supplier_cost: cost,
      active: skuAvailable,
      last_synced_at: now,
      updated_at: now,
    });
  }

  // Katalog Nambah harus cermin Digiflazz: produk yang SKU-nya sudah dihapus
  // tidak boleh tetap ada. Dulu mapping-nya hanya dimatikan sehingga produk
  // yatim masih_sky leftover di database.
  const catalogSkus = new Set(catalogItems.map((item) => item.supplier_sku));
  const orphanMappings = mappings.filter(
    (mapping) => mapping.supplier_sku && !catalogSkus.has(mapping.supplier_sku),
  );
  const orphanProductIds = new Set(
    orphanMappings.map((mapping) => mapping.product_id),
  );
  const orphanProducts = products.filter((product) => orphanProductIds.has(product.id));

  // Produk berhistori order tidak boleh dihapus (orders.product_id tidak
  // ber-cascade); produk seperti itu hanya dinonaktifkan.
  const referencedByOrders = await supabaseSelectAll<{ product_id: string }>("orders", {
    select: "product_id",
    order: "product_id.asc",
  });
  const orderedProductIds = new Set(
    referencedByOrders.map((row) => row.product_id).filter(Boolean),
  );

  const productsToDelete = orphanProducts.filter(
    (product) => !orderedProductIds.has(product.id),
  );
  const productsToDeactivateOnly = orphanProducts.filter((product) =>
    orderedProductIds.has(product.id),
  );

  const summary: CatalogSyncSummary = {
    catalogItems: catalogItems.length,
    catalogSource: catalog.source,
    catalogScanAt: catalog.scannedAt,
    staleWarning:
      catalog.source === "cache"
        ? "Live price-list tidak terbaca, jadi sinkron memakai cache katalog terakhir."
        : null,
    productsCreated: newProducts.length,
    mappingsCreated: newMappings.length,
    costsRefreshed: costUpdates.length,
    pricesRaised: priceUpdates.length,
    deactivatedMissingSku: orphanMappings.length,
    productsRemoved: productsToDelete.length,
    productsHidden: productsToDeactivateOnly.length,
    gamesActivated: gamesToActivate.size,
    expectedActiveMappings: 0,
    failures: [],
  };

  // Jumlahkan mapping yang akan aktif setelah sinkron; ini angka "unmapped"
  // yang dilihat admin di panel katalog.
  const expectedActiveMappings =
    catalogItems.length - productsToDelete.length - productsToDeactivateOnly.length;

  const run = async (): Promise<CatalogSyncSummary> => {

  for (const batch of chunk(newGames, 100)) {
    try {
      await supabaseInsert("games", batch);
    } catch (error) {
      summary.failures.push(
        `games: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const batch of chunk(newProducts, UPSERT_BATCH)) {
    try {
      await supabaseUpsert("products", batch, {
        onConflict: "id",
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    } catch (error) {
      summary.failures.push(
        `products: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const batch of chunk(newMappings, UPSERT_BATCH)) {
    try {
      await supabaseUpsert("supplier_products", batch, {
        onConflict: "supplier_id,product_id",
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    } catch (error) {
      summary.failures.push(
        `supplier_products: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const batch of chunk(costUpdates, UPSERT_BATCH)) {
    try {
      await supabaseUpsert("supplier_products", batch, {
        onConflict: "supplier_id,product_id",
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    } catch (error) {
      summary.failures.push(
        `harga modal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const batch of chunk(
    orphanMappings.map((mapping) => ({
      supplier_id: "digiflazz",
      product_id: mapping.product_id,
      supplier_sku: mapping.supplier_sku,
      supplier_cost: Number(mapping.supplier_cost),
      active: false,
      last_synced_at: now,
      updated_at: now,
    })),
    UPSERT_BATCH,
  )) {
    try {
      await supabaseUpsert("supplier_products", batch, {
        onConflict: "supplier_id,product_id",
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    } catch (error) {
      summary.failures.push(
        `nonaktifkan SKU hilang: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Produk tanpa SKU di Digiflazz dihapus supaya katalog benar-benar cermin.
  for (const product of productsToDelete) {
    try {
      await supabaseDelete("supplier_products", {
        filters: { supplier_id: "eq.digiflazz", product_id: `eq.${product.id}` },
      });
      await supabaseDelete("products", { filters: { id: `eq.${product.id}` } });
    } catch (error) {
      summary.failures.push(
        `hapus produk tanpa SKU (${product.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const batch of chunk(
    [
      ...priceUpdates,
      ...productsToDeactivateOnly.map((product) => ({
        id: product.id,
        active: false,
        updated_at: now,
      })),
    ],
    100,
  )) {
    for (const row of batch) {
      const { id, ...rest } = row as { id: string } & Record<string, unknown>;
      try {
        await supabaseUpdate("products", rest, { filters: { id: `eq.${id}` } });
      } catch (error) {
        summary.failures.push(
          `harga produk ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const gamesToActivateIds = [...gamesToActivate].filter(Boolean);
  for (const batch of chunk(gamesToActivateIds, 100)) {
    try {
      for (const gameId of batch) {
        await supabaseUpdate(
          "games",
          { active: true, updated_at: now },
          { filters: { id: `eq.${gameId}` } },
        );
      }
    } catch (error) {
      summary.failures.push(
        `aktivasi game: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
  };

  return { summary: { ...summary, expectedActiveMappings }, apply: run };
}

/**
 * Sinkron penuh katalog Nambah dari katalog Digiflazz.
 *
 * Dipakai semua tool sinkron di admin supaya hasilnya selalu sama: mapping
 * mengikuti supplier_sku, SKU baru jadi produk baru, dan SKU yang hilang
 * membuat produknya dihapus (kecuali punya riwayat order).
 */
export async function syncCatalogWithSupplier(input?: {
  dryRun?: boolean;
  preferLive?: boolean;
}): Promise<CatalogSyncSummary> {
  const plan = await planCatalogSync({ preferLive: input?.preferLive !== false });
  if (input?.dryRun === true) return plan.summary;
  return plan.apply();
}