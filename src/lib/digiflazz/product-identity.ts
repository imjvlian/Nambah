import { createHash } from "node:crypto";

/**
 * Identitas produk katalog supplier.
 *
 * Dipakai bersama oleh publish per-item dan sinkron penuh supaya keduanya
 * menghasilkan product_id, label, dan harga yang sama persis. Kalau logikanya
 * terpisah, produk bisa_dozen berbeda untuk SKU yang sama.
 */

export type SupplierCatalogItem = {
  supplier_sku: string;
  product_name: string;
  category: string;
  brand: string;
  type: string;
  supplier_cost: number | string;
  buyer_active: boolean;
  seller_active: boolean;
};

export type GameRow = {
  id: string;
  name: string;
  short_name: string;
  category: "game" | "voucher";
  accent: string;
  initials: string;
  requires_server: boolean;
  active: boolean;
};

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "-");
}

export function titleCase(value: string) {
  return value.replace(/\w\S*/g, (part) => part[0].toUpperCase() + part.slice(1).toLowerCase());
}

export function makeInitials(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

export function stableAccent(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 68% 61%)`;
}

export function inferCategory(value: string): "game" | "voucher" {
  return /game/i.test(value ?? "") ? "game" : "voucher";
}

export function inferRequiresServer(brand: string) {
  const normalized = normalizeText(brand ?? "");
  return ["mobile legends", "genshin impact"].some((name) => normalized.includes(name));
}

export function cleanProductLabel(productName: string, brand: string) {
  const escaped = String(brand ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutBrand = productName
    .replace(new RegExp(`^${escaped}\\s*[-–—:|]?\\s*`, "i"), "")
    .trim();
  return withoutBrand || productName.trim();
}

export function roundUpToHundred(value: number) {
  return Math.ceil(Math.max(0, value) / 100) * 100;
}

/**
 * Id produk diturunkan dari supplier_sku, jadi produk selalu bisa dipetakan
 * balik ke SKU Digiflazz tanpa menebak.
 */
export function makeProductId(supplierSku: string) {
  const slug = slugify(supplierSku).slice(0, 36) || "sku";
  const digest = createHash("sha1").update(supplierSku).digest("hex").slice(0, 10);
  return `df-${slug}-${digest}`;
}

export function makeGameDefaults(item: SupplierCatalogItem) {
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
 * Cari game yang cocok untuk satu SKU. Prioritaskan game yang nama/short name
 *-nya sama dengan brand SKU; kalau tidak ada, buat id baru dari slug brand.
 */
export function resolveGame(
  item: SupplierCatalogItem,
  games: GameRow[],
): { game: GameRow; create: boolean } {
  const defaults = makeGameDefaults(item);
  const normalizedBrand = normalizeText(item.brand);

  const existing = games.find(
    (candidate) =>
      candidate.id === defaults.id ||
      normalizeText(candidate.name) === normalizedBrand ||
      normalizeText(candidate.short_name) === normalizedBrand,
  );

  if (existing) return { game: existing, create: false };

  return {
    game: {
      id: defaults.id,
      name: defaults.name,
      short_name: defaults.shortName,
      category: defaults.category,
      accent: defaults.accent,
      initials: defaults.initials,
      requires_server: defaults.requiresServer,
      active: true,
    },
    create: true,
  };
}

export function minimumSellingPrice(supplierCost: number, minimumProfit: number) {
  return roundUpToHundred(supplierCost + minimumProfit);
}