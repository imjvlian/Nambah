import { createHash } from "node:crypto";
import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";
import { generateInternalSku, internalSkuWithSuffix } from "@/lib/internal-sku";

export const runtime = "nodejs";

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
  last_seen_at: string;
};

type SupplierProductRow = {
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
  internal_sku: string | null;
};

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  category: "game" | "voucher";
  accent: string;
  initials: string;
  requires_server: boolean;
  active: boolean;
};

type PricingRuleRow = {
  minimum_nambah_profit: number | string;
};

type PublicationRequest = {
  supplierSku: string;
  published: boolean;
};

type PublicationResult = {
  supplierSku: string;
  productId: string | null;
  gameId?: string;
  gameName?: string;
  published: boolean;
  created: boolean;
  gameCreated?: boolean;
  sellingPrice?: number;
  referencePrice?: number;
};

class PublicationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PublicationError";
    this.status = status;
  }
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeText(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function makeInitials(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2)
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function stableAccent(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 68% 61%)`;
}

function inferCategory(value: string): "game" | "voucher" {
  return /game/i.test(value) ? "game" : "voucher";
}

function inferRequiresServer(brand: string) {
  const normalized = normalizeText(brand);
  return ["mobile legends", "genshin impact"].some((name) =>
    normalized.includes(name),
  );
}

function cleanProductLabel(productName: string, brand: string) {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutBrand = productName
    .replace(new RegExp(`^${escaped}\\s*[-–—:|]?\\s*`, "i"), "")
    .trim();
  return withoutBrand || productName.trim();
}

function roundUpToHundred(value: number) {
  return Math.ceil(Math.max(0, value) / 100) * 100;
}

function makeProductId(supplierSku: string) {
  const slug = slugify(supplierSku).slice(0, 36) || "sku";
  const digest = createHash("sha1")
    .update(supplierSku)
    .digest("hex")
    .slice(0, 10);
  return `df-${slug}-${digest}`;
}

function makeGameDefaults(item: SupplierCatalogRow) {
  const brandName = titleCase(item.brand || item.category || "Produk Digital");
  const initials = makeInitials(brandName);
  return {
    id: slugify(item.brand || item.category || "digiflazz") || "digiflazz",
    name: brandName,
    shortName: brandName.length <= 18 ? brandName : initials,
    category: inferCategory(item.category),
    accent: stableAccent(item.brand || item.category || item.supplier_sku),
    initials,
    requiresServer: inferRequiresServer(item.brand),
  };
}

/**
 * SKU internal bebas untuk satu item katalog Digiflazz.
 *
 * Pemeriksaan bentrok lewat database, bukan Set di memori, karena publish
 * diproses satu item per permintaan - tidak ada batch yang bisa dihitung
 * di muka. Generator dan aturan akhiran tetap dari `internal-sku.ts`;
 * yang async di sini hanya jawaban "sudah dipakai produk lain atau belum".
 *
 * `kecualiProductId`: produk yang SEDANG diproses tidak dihitung bentrok
 * dengan dirinya sendiri - misalnya publish ulang produk yang sudah
 * ber-SKU internal.
 */
async function skuInternalUntukItem(
  item: SupplierCatalogRow,
  gameId: string,
  label: string,
  kecualiProductId?: string,
): Promise<string | null> {
  const input = { gameId, label, jenis: item.type };
  const dasar = generateInternalSku(input, item.supplier_sku);
  if (!dasar) return null;

  const bentrok = async (sku: string): Promise<boolean> => {
    const baris = await supabaseSelect<{ id: string }>("products", {
      select: "id",
      filters: { internal_sku: `eq.${sku}` },
      limit: 1,
    });
    return baris.length > 0 && baris[0].id !== kecualiProductId;
  };

  if (!(await bentrok(dasar))) return dasar;

  for (let suffix = 2; suffix < 50; suffix += 1) {
    const kandidat = internalSkuWithSuffix(input, suffix, item.supplier_sku);
    if (!kandidat) break;
    if (!(await bentrok(kandidat))) return kandidat;
  }

  return null;
}

function parsePublicationRequest(value: unknown): PublicationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicationError("Item publish katalog tidak valid.");
  }

  const item = value as { supplierSku?: unknown; published?: unknown };
  const supplierSku =
    typeof item.supplierSku === "string" ? item.supplierSku.trim() : "";
  if (!supplierSku) throw new PublicationError("supplierSku wajib diisi.");
  if (typeof item.published !== "boolean") {
    throw new PublicationError(
      `Status tampil ${supplierSku} harus berupa boolean.`,
    );
  }

  return { supplierSku, published: item.published };
}

async function applyPublication(
  input: PublicationRequest,
): Promise<PublicationResult> {
  const [item] = await supabaseSelect<SupplierCatalogRow>(
    "supplier_catalog_items",
    {
      select:
        "supplier_sku,product_name,category,brand,type,seller_name,supplier_cost,buyer_active,seller_active,last_seen_at",
      filters: {
        supplier_id: "eq.digiflazz",
        supplier_sku: `eq.${input.supplierSku}`,
      },
      limit: 1,
    },
  );

  if (!item) {
    throw new PublicationError(
      "SKU tidak ditemukan pada katalog Digiflazz hasil scan.",
      404,
    );
  }

  const [existingMapping] = await supabaseSelect<SupplierProductRow>(
    "supplier_products",
    {
      select: "product_id,supplier_sku,supplier_cost,active",
      filters: {
        supplier_id: "eq.digiflazz",
        supplier_sku: `eq.${item.supplier_sku}`,
      },
      limit: 1,
    },
  );

  if (!input.published) {
    if (!existingMapping) {
      return {
        supplierSku: item.supplier_sku,
        productId: null,
        published: false,
        created: false,
      };
    }

    await supabaseUpdate(
      "products",
      { active: false, updated_at: new Date().toISOString() },
      { filters: { id: `eq.${existingMapping.product_id}` } },
    );

    return {
      supplierSku: item.supplier_sku,
      productId: existingMapping.product_id,
      published: false,
      created: false,
    };
  }

  if (!item.buyer_active || !item.seller_active) {
    throw new PublicationError(
      "SKU supplier sedang tidak aktif dan tidak bisa ditampilkan ke user.",
      409,
    );
  }

  const [pricingRows, games] = await Promise.all([
    supabaseSelect<PricingRuleRow>("pricing_rules", {
      select: "minimum_nambah_profit",
      filters: { id: "eq.default" },
      limit: 1,
    }),
    supabaseSelect<GameRow>("games", {
      select:
        "id,name,short_name,category,accent,initials,requires_server,active",
    }),
  ]);

  const minimumProfit = Number(pricingRows[0]?.minimum_nambah_profit ?? 500);
  const supplierCost = Number(item.supplier_cost);
  const minimumSellingPrice = roundUpToHundred(supplierCost + minimumProfit);
  const now = new Date().toISOString();

  if (existingMapping) {
    const [product] = await supabaseSelect<ProductRow>("products", {
      select:
        "id,game_id,label,selling_price,reference_price,active,internal_sku",
      filters: { id: `eq.${existingMapping.product_id}` },
      limit: 1,
    });

    if (!product) {
      throw new PublicationError(
        `Mapping supplier ada tetapi produk ${BRAND.shortName} tidak ditemukan.`,
        409,
      );
    }

    const nextSellingPrice = Math.max(
      Number(product.selling_price),
      minimumSellingPrice,
    );
    const nextReferencePrice = Math.max(
      Number(product.reference_price),
      nextSellingPrice,
    );

    /*
     * Publish ulang produk lama: SKU internal yang kosong ikut diisi,
     * karena cabang ini yang paling sering dijalankan operator untuk
     * produk yang sudah pernah dipublish sebelum fitur SKU internal.
     */
    let isiInternalSku: Record<string, unknown> = {};
    if (!product.internal_sku) {
      const sku = await skuInternalUntukItem(
        item,
        product.game_id,
        product.label,
        product.id,
      );
      if (sku) isiInternalSku = { internal_sku: sku };
    }

    await Promise.all([
      supabaseUpdate(
        "products",
        {
          active: true,
          selling_price: nextSellingPrice,
          reference_price: nextReferencePrice,
          updated_at: now,
          ...isiInternalSku,
        },
        { filters: { id: `eq.${product.id}` } },
      ),
      supabaseUpdate(
        "supplier_products",
        {
          supplier_cost: supplierCost,
          active: true,
          last_synced_at: now,
          updated_at: now,
        },
        {
          filters: {
            supplier_id: "eq.digiflazz",
            product_id: `eq.${product.id}`,
          },
        },
      ),
      supabaseUpdate(
        "games",
        { active: true, updated_at: now },
        { filters: { id: `eq.${product.game_id}` } },
      ),
    ]);

    return {
      supplierSku: item.supplier_sku,
      productId: product.id,
      published: true,
      created: false,
      sellingPrice: nextSellingPrice,
      referencePrice: nextReferencePrice,
    };
  }

  const gameDefaults = makeGameDefaults(item);
  const normalizedBrand = normalizeText(item.brand);
  let game = games.find(
    (candidate) =>
      candidate.id === gameDefaults.id ||
      normalizeText(candidate.name) === normalizedBrand ||
      normalizeText(candidate.short_name) === normalizedBrand,
  );
  let gameCreated = false;

  if (!game) {
    const [createdGame] = await supabaseInsert<GameRow>("games", {
      id: gameDefaults.id,
      name: gameDefaults.name,
      short_name: gameDefaults.shortName,
      category: gameDefaults.category,
      accent: gameDefaults.accent,
      initials: gameDefaults.initials,
      requires_server: gameDefaults.requiresServer,
      active: true,
      sort_order: 1000,
      created_at: now,
      updated_at: now,
    });
    game = createdGame;
    gameCreated = true;
  } else if (!game.active) {
    await supabaseUpdate(
      "games",
      { active: true, updated_at: now },
      { filters: { id: `eq.${game.id}` } },
    );
    game = { ...game, active: true };
  }

  if (!game) throw new Error("Game katalog gagal dibuat.");

  const productId = makeProductId(item.supplier_sku);
  const [existingProduct] = await supabaseSelect<ProductRow>("products", {
    select:
      "id,game_id,label,selling_price,reference_price,active,internal_sku",
    filters: { id: `eq.${productId}` },
    limit: 1,
  });

  if (!existingProduct) {
    /*
     * SKU internal dibuat saat produk lahir - bukan lewat backfill
     * terpisah. Alur centang-then-publish inilah yang dipakai operator
     * untuk menambah produk dari katalog Digiflazz, jadi tanpa ini
     * mayoritas produk baru tetap tanpa SKU internal dan merge
     * Melostore tidak pernah menemukannya.
     */
    const label = cleanProductLabel(item.product_name, item.brand);
    const internalSku = await skuInternalUntukItem(item, game.id, label);

    await supabaseInsert("products", {
      id: productId,
      game_id: game.id,
      label,
      note: item.type && item.type !== "-" ? item.type : null,
      selling_price: minimumSellingPrice,
      reference_price: minimumSellingPrice,
      active: true,
      internal_sku: internalSku,
      sort_order: Math.min(
        2_000_000_000,
        Math.max(0, Math.round(supplierCost)),
      ),
      created_at: now,
      updated_at: now,
    });
  } else {
    const nextSellingPrice = Math.max(
      Number(existingProduct.selling_price),
      minimumSellingPrice,
    );
    /*
     * Produk lama yang belum punya SKU internal diisi DI SINI, bukan
     * hanya di jalur sync - dua jalur ini berdiri sendiri, dan operator
     * yang hanya memakai publish tidak pernah menjalankan sync.
     */
    const isiInternalSku: Record<string, unknown> = {};
    if (!existingProduct.internal_sku) {
      const sku = await skuInternalUntukItem(
        item,
        existingProduct.game_id,
        existingProduct.label,
        existingProduct.id,
      );
      if (sku) isiInternalSku.internal_sku = sku;
    }

    await supabaseUpdate(
      "products",
      {
        active: true,
        selling_price: nextSellingPrice,
        reference_price: Math.max(
          Number(existingProduct.reference_price),
          nextSellingPrice,
        ),
        updated_at: now,
        ...isiInternalSku,
      },
      { filters: { id: `eq.${productId}` } },
    );
  }

  await supabaseUpsert(
    "supplier_products",
    {
      supplier_id: "digiflazz",
      product_id: productId,
      supplier_sku: item.supplier_sku,
      supplier_cost: supplierCost,
      active: true,
      last_synced_at: now,
      updated_at: now,
    },
    {
      onConflict: "supplier_id,product_id",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
  );

  return {
    supplierSku: item.supplier_sku,
    productId,
    gameId: game.id,
    gameName: game.name,
    published: true,
    created: !existingProduct,
    gameCreated,
    sellingPrice: minimumSellingPrice,
    referencePrice: minimumSellingPrice,
  };
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request publish katalog tidak valid." },
      { status: 400 },
    );
  }

  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new PublicationError("Request publish katalog tidak valid.");
    }

    const payload = body as {
      items?: unknown;
      supplierSku?: unknown;
      published?: unknown;
    };

    if (Array.isArray(payload.items)) {
      if (payload.items.length === 0) {
        throw new PublicationError("Daftar perubahan publish kosong.");
      }
      if (payload.items.length > 100) {
        throw new PublicationError(
          "Maksimal 100 perubahan publish per request.",
        );
      }

      const deduped = new Map<string, PublicationRequest>();
      for (const rawItem of payload.items) {
        const parsed = parsePublicationRequest(rawItem);
        deduped.set(parsed.supplierSku.toUpperCase(), parsed);
      }

      const results: Array<
        | { supplierSku: string; ok: true; publication: PublicationResult }
        | { supplierSku: string; ok: false; error: string; status: number }
      > = [];

      for (const item of deduped.values()) {
        try {
          const publication = await applyPublication(item);
          results.push({
            supplierSku: item.supplierSku,
            ok: true,
            publication,
          });
        } catch (error) {
          if (error instanceof PublicationError) {
            results.push({
              supplierSku: item.supplierSku,
              ok: false,
              error: error.message,
              status: error.status,
            });
          } else {
            console.error(
              "Digiflazz catalog batch publish item failed",
              item.supplierSku,
              error,
            );
            results.push({
              supplierSku: item.supplierSku,
              ok: false,
              error: "Status tampil produk Digiflazz gagal diperbarui.",
              status: 502,
            });
          }
        }
      }

      const successful = results.filter(
        (result): result is Extract<(typeof results)[number], { ok: true }> =>
          result.ok,
      );

      await auditAdminAction(request, {
        action: "digiflazz.catalog_publish_batch",
        targetType: "supplier_catalog",
        targetId: Array.from(deduped.keys()).join(","),
        metadata: {
          requested: results.length,
          succeeded: successful.length,
          failed: results.length - successful.length,
          published: successful.filter((result) => result.publication.published)
            .length,
          hidden: successful.filter((result) => !result.publication.published)
            .length,
          created: successful.filter((result) => result.publication.created)
            .length,
        },
      });

      return Response.json({
        summary: {
          requested: results.length,
          succeeded: successful.length,
          failed: results.length - successful.length,
          published: successful.filter((result) => result.publication.published)
            .length,
          hidden: successful.filter((result) => !result.publication.published)
            .length,
          created: successful.filter((result) => result.publication.created)
            .length,
        },
        results,
      });
    }

    const single = parsePublicationRequest(payload);
    const publication = await applyPublication(single);

    await auditAdminAction(request, {
      action: "digiflazz.catalog_publish",
      targetType: "supplier_catalog",
      targetId: single.supplierSku,
      metadata: {
        published: publication.published,
        created: publication.created,
        productId: publication.productId,
        gameId: publication.gameId ?? null,
        gameName: publication.gameName ?? null,
        sellingPrice: publication.sellingPrice ?? null,
        referencePrice: publication.referencePrice ?? null,
      },
    });

    return Response.json({ publication });
  } catch (error) {
    if (error instanceof PublicationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Digiflazz catalog publish failed", error);
    return Response.json(
      { error: "Status tampil produk Digiflazz gagal diperbarui." },
      { status: 502 },
    );
  }
}
