import { createHash } from "node:crypto";
import { authorizeAdminRequest } from "@/lib/admin-api";
import {
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";

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

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
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
  if (words.length >= 2) return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
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
  return ["mobile legends", "genshin impact"].some((name) => normalized.includes(name));
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
  const digest = createHash("sha1").update(supplierSku).digest("hex").slice(0, 10);
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

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: { supplierSku?: string; published?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request publish katalog tidak valid." }, { status: 400 });
  }

  const supplierSku = body.supplierSku?.trim() ?? "";
  const published = body.published === true;

  if (!supplierSku) {
    return Response.json({ error: "supplierSku wajib diisi." }, { status: 400 });
  }

  try {
    const [item] = await supabaseSelect<SupplierCatalogRow>("supplier_catalog_items", {
      select:
        "supplier_sku,product_name,category,brand,type,seller_name,supplier_cost,buyer_active,seller_active,last_seen_at",
      filters: {
        supplier_id: "eq.digiflazz",
        supplier_sku: `eq.${supplierSku}`,
      },
      limit: 1,
    });

    if (!item) {
      return Response.json(
        { error: "SKU tidak ditemukan pada katalog Digiflazz hasil scan." },
        { status: 404 },
      );
    }

    const [existingMapping] = await supabaseSelect<SupplierProductRow>("supplier_products", {
      select: "product_id,supplier_sku,supplier_cost,active",
      filters: {
        supplier_id: "eq.digiflazz",
        supplier_sku: `eq.${item.supplier_sku}`,
      },
      limit: 1,
    });

    if (!published) {
      if (!existingMapping) {
        return Response.json({
          publication: {
            supplierSku: item.supplier_sku,
            productId: null,
            published: false,
            created: false,
          },
        });
      }

      await supabaseUpdate(
        "products",
        { active: false, updated_at: new Date().toISOString() },
        { filters: { id: `eq.${existingMapping.product_id}` } },
      );

      return Response.json({
        publication: {
          supplierSku: item.supplier_sku,
          productId: existingMapping.product_id,
          published: false,
          created: false,
        },
      });
    }

    if (!item.buyer_active || !item.seller_active) {
      return Response.json(
        { error: "SKU supplier sedang tidak aktif dan tidak bisa ditampilkan ke user." },
        { status: 409 },
      );
    }

    const [pricingRows, games] = await Promise.all([
      supabaseSelect<PricingRuleRow>("pricing_rules", {
        select: "minimum_nambah_profit",
        filters: { id: "eq.default" },
        limit: 1,
      }),
      supabaseSelect<GameRow>("games", {
        select: "id,name,short_name,category,accent,initials,requires_server,active",
      }),
    ]);

    const minimumProfit = Number(pricingRows[0]?.minimum_nambah_profit ?? 500);
    const supplierCost = Number(item.supplier_cost);
    const minimumSellingPrice = roundUpToHundred(supplierCost + minimumProfit);
    const now = new Date().toISOString();

    if (existingMapping) {
      const [product] = await supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label,selling_price,reference_price,active",
        filters: { id: `eq.${existingMapping.product_id}` },
        limit: 1,
      });

      if (!product) {
        return Response.json(
          { error: "Mapping supplier ada tetapi produk Nambah tidak ditemukan." },
          { status: 409 },
        );
      }

      const nextSellingPrice = Math.max(Number(product.selling_price), minimumSellingPrice);
      const nextReferencePrice = Math.max(Number(product.reference_price), nextSellingPrice);

      await Promise.all([
        supabaseUpdate(
          "products",
          {
            active: true,
            selling_price: nextSellingPrice,
            reference_price: nextReferencePrice,
            updated_at: now,
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

      return Response.json({
        publication: {
          supplierSku: item.supplier_sku,
          productId: product.id,
          published: true,
          created: false,
          sellingPrice: nextSellingPrice,
          referencePrice: nextReferencePrice,
        },
      });
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

    if (!game) {
      throw new Error("Game katalog gagal dibuat.");
    }

    const productId = makeProductId(item.supplier_sku);
    const [existingProduct] = await supabaseSelect<ProductRow>("products", {
      select: "id,game_id,label,selling_price,reference_price,active",
      filters: { id: `eq.${productId}` },
      limit: 1,
    });

    if (!existingProduct) {
      await supabaseInsert("products", {
        id: productId,
        game_id: game.id,
        label: cleanProductLabel(item.product_name, item.brand),
        note: item.type && item.type !== "-" ? item.type : null,
        selling_price: minimumSellingPrice,
        reference_price: minimumSellingPrice,
        active: true,
        sort_order: Math.min(2_000_000_000, Math.max(0, Math.round(supplierCost))),
        created_at: now,
        updated_at: now,
      });
    } else {
      await supabaseUpdate(
        "products",
        {
          active: true,
          selling_price: Math.max(Number(existingProduct.selling_price), minimumSellingPrice),
          reference_price: Math.max(
            Number(existingProduct.reference_price),
            Math.max(Number(existingProduct.selling_price), minimumSellingPrice),
          ),
          updated_at: now,
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

    return Response.json({
      publication: {
        supplierSku: item.supplier_sku,
        productId,
        gameId: game.id,
        gameName: game.name,
        published: true,
        created: !existingProduct,
        gameCreated,
        sellingPrice: minimumSellingPrice,
        referencePrice: minimumSellingPrice,
      },
    });
  } catch (error) {
    console.error("Digiflazz catalog publish failed", error);
    return Response.json(
      { error: "Status tampil produk Digiflazz gagal diperbarui." },
      { status: 502 },
    );
  }
}
