import manifestJson from "../../public/product-assets/codashop/manifest.json";
import type { Game, GamePackage } from "@/lib/catalog";

type ProductAsset = {
  alt: string | null;
  kind: "cover" | "nominal" | string | null;
  localPath: string;
};

type ProductAssetEntry = {
  name: string;
  cover?: string | null;
  assets: ProductAsset[];
};

type ProductAssetManifest = {
  products: Record<string, ProductAssetEntry>;
};

type UnitFamily =
  | "diamond"
  | "uc"
  | "robux"
  | "crystal"
  | "token"
  | "point"
  | "shell"
  | "coin"
  | "credit"
  | "coupon"
  | "idr";

type SpecialIntent =
  | "weekly-diamond-pass"
  | "weekly-membership"
  | "monthly-membership"
  | "welkin"
  | "twilight-pass"
  | "starlight"
  | "booyah-pass"
  | "battle-pass"
  | "weekly-pack"
  | "monthly-pack"
  | "first-top-up";

const manifest = manifestJson as unknown as ProductAssetManifest;

const STOP_WORDS = new Set([
  "top",
  "up",
  "mobile",
  "game",
  "games",
  "voucher",
  "the",
  "of",
  "and",
  "id",
  "indonesia",
  "instant",
  "instan",
  "pack",
  "paket",
  "code",
]);

const PRODUCT_ALIASES: Record<string, string[]> = {
  "mobile-legends": ["mobile legends", "mobile legends bang bang", "mlbb"],
  "free-fire": ["free fire", "garena free fire"],
  "pubg-mobile": ["pubg mobile", "playerunknown battleground mobile", "pubg"],
  valorant: ["valorant", "valorant points"],
  "honor-of-kings": ["honor of kings"],
  "genshin-impact": ["genshin impact", "genshin"],
  roblox: ["roblox", "robux"],
  "steam-wallet": ["steam wallet", "steam wallet code indonesia"],
};

const PRODUCT_SLUG_ALIASES: Record<string, string[]> = {
  "mobile-legends": ["mobile-legends"],
  "free-fire": ["free-fire"],
  "pubg-mobile": ["pubg-mobile"],
  valorant: ["valorant"],
  "honor-of-kings": ["honor-of-kings"],
  "genshin-impact": ["genshin-impact"],
  roblox: ["roblox"],
  "steam-wallet": ["steam-wallet", "steam-wallet-code-indonesia"],
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string) {
  return normalize(value).replace(/\s+/g, "");
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function numberValues(value: string): number[] {
  const matches = value.match(/\d{1,3}(?:[.,]\d{3})+|\d+/g) ?? [];
  return matches
    .map((match) => Number(match.replace(/[.,]/g, "")))
    .filter((number) => Number.isFinite(number));
}

function sameNumbers(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function unitFamilies(value: string): Set<UnitFamily> {
  const text = normalize(value);
  const families = new Set<UnitFamily>();

  if (/\bdiamonds?\b/.test(text)) families.add("diamond");
  if (/\buc\b|unknown cash/.test(text)) families.add("uc");
  if (/\brobux\b/.test(text)) families.add("robux");
  if (/\b(?:genesis\s+)?crystals?\b/.test(text)) families.add("crystal");
  if (/\btokens?\b/.test(text)) families.add("token");
  if (/\bpoints?\b|\bvp\b|\brp\b/.test(text)) families.add("point");
  if (/\bshells?\b/.test(text)) families.add("shell");
  if (/\bcoins?\b/.test(text)) families.add("coin");
  if (/\bcredits?\b/.test(text)) families.add("credit");
  if (/\bcoupons?\b/.test(text)) families.add("coupon");
  if (/\bidr\b/.test(text)) families.add("idr");

  return families;
}

function compatibleUnits(left: Set<UnitFamily>, right: Set<UnitFamily>) {
  if (left.size === 0) return true;
  if (right.size === 0) return false;
  return [...left].some((family) => right.has(family));
}

function specialIntent(value: string): SpecialIntent | null {
  const text = normalize(value);

  if (/weekly diamond pass/.test(text)) return "weekly-diamond-pass";
  if (/weekly membership/.test(text)) return "weekly-membership";
  if (/monthly membership/.test(text)) return "monthly-membership";
  if (/welkin/.test(text)) return "welkin";
  if (/twilight pass/.test(text)) return "twilight-pass";
  if (/starlight/.test(text)) return "starlight";
  if (/booyah pass/.test(text)) return "booyah-pass";
  if (/battle pass/.test(text)) return "battle-pass";
  if (/weekly (?:elite|epic)? ?pack|paket mingguan/.test(text)) return "weekly-pack";
  if (/monthly (?:elite|epic)? ?(?:pack|bundle)|paket bulanan/.test(text)) return "monthly-pack";
  if (
    /first top up|first topup|first recharge|top up pertama|topup pertama|pengisian pertama|double diamond|double bonus/.test(
      text,
    )
  ) {
    return "first-top-up";
  }

  return null;
}

function productCandidates(game: Game): string[] {
  const aliases = PRODUCT_ALIASES[game.id] ?? [];
  return [game.id, game.name, game.shortName, ...aliases]
    .map(normalize)
    .filter(Boolean);
}

function exactProductBySlug(game: Game) {
  const candidates = [game.id, ...(PRODUCT_SLUG_ALIASES[game.id] ?? [])];
  for (const candidate of candidates) {
    const product = manifest.products[candidate];
    if (product) return product;
  }
  return null;
}

function scoreProduct(game: Game, slug: string, product: ProductAssetEntry) {
  const candidates = productCandidates(game);
  const slugNormalized = normalize(slug);
  const nameNormalized = normalize(product.name);
  const slugCompact = compact(slug);
  const nameCompact = compact(product.name);
  const productTokens = new Set(tokens(`${slug} ${product.name}`));

  let score = 0;
  for (const candidate of candidates) {
    const candidateCompact = compact(candidate);
    const candidateTokens = tokens(candidate);

    if (slugNormalized === candidate || nameNormalized === candidate) {
      score = Math.max(score, 200);
      continue;
    }
    if (slugCompact === candidateCompact || nameCompact === candidateCompact) {
      score = Math.max(score, 190);
      continue;
    }

    // Do not fuzzy-match short aliases such as FF/VP/RB. They are too easy to
    // collide with unrelated product names.
    if (candidateTokens.length < 2) continue;

    const overlap = candidateTokens.filter((token) => productTokens.has(token)).length;
    const coverage = overlap / candidateTokens.length;
    if (coverage === 1) score = Math.max(score, 125 + candidateTokens.length * 5);
    else if (coverage >= 0.75) score = Math.max(score, 100 + overlap * 4);
  }

  return score;
}

function findProduct(game: Game) {
  const exact = exactProductBySlug(game);
  if (exact) return exact;

  let best: { product: ProductAssetEntry; score: number } | null = null;
  for (const [slug, product] of Object.entries(manifest.products)) {
    const score = scoreProduct(game, slug, product);
    if (!best || score > best.score) best = { product, score };
  }

  return best && best.score >= 125 ? best.product : null;
}

function scoreNominalAsset(item: GamePackage, asset: ProductAsset): number | null {
  if (asset.kind !== "nominal" || !asset.alt) return null;

  const label = normalize(item.label);
  const alt = normalize(asset.alt);
  if (!label || !alt) return null;

  if (label === alt) return 1000;
  if (compact(label) === compact(alt)) return 990;

  const itemIntent = specialIntent(label);
  const assetIntent = specialIntent(alt);
  const itemNumbers = numberValues(item.label);
  const assetNumbers = numberValues(asset.alt);
  const itemUnits = unitFamilies(label);
  const assetUnits = unitFamilies(alt);

  // Special products are matched by their semantic intent first. A weekly
  // pass must never become a monthly pack, first-top-up bundle, etc.
  if (itemIntent || assetIntent) {
    if (!itemIntent || itemIntent !== assetIntent) return null;
    if (!compatibleUnits(itemUnits, assetUnits)) return null;

    // First-top-up artwork often contains bonus breakdowns such as
    // "100 Diamonds (50+50)" while Nambah may only say "100 Diamonds".
    if (itemNumbers.length > 0 && assetNumbers.length > 0) {
      if (itemIntent === "first-top-up") {
        if (itemNumbers[0] !== assetNumbers[0]) return null;
      } else if (!sameNumbers(itemNumbers, assetNumbers)) {
        return null;
      }
    }

    const overlap = tokens(label).filter((token) => new Set(tokens(alt)).has(token)).length;
    return 700 + overlap * 10;
  }

  // Normal denominations are intentionally strict. Matching 86 Diamonds to
  // 85 Diamonds (or 300+30 Crystals to 300 Crystals) is visually misleading.
  if (itemNumbers.length === 0 || assetNumbers.length === 0) return null;
  if (!sameNumbers(itemNumbers, assetNumbers)) return null;
  if (!compatibleUnits(itemUnits, assetUnits)) return null;

  const itemTokens = new Set(tokens(label));
  const assetTokens = new Set(tokens(alt));
  const overlap = [...itemTokens].filter((token) => assetTokens.has(token)).length;

  return 500 + overlap * 10;
}

function findNominalAsset(product: ProductAssetEntry, item: GamePackage) {
  let best: { asset: ProductAsset; score: number } | null = null;

  for (const asset of product.assets) {
    const score = scoreNominalAsset(item, asset);
    if (score === null) continue;
    if (!best || score > best.score) best = { asset, score };
  }

  return best?.asset ?? null;
}

export type ResolvedProductAsset = {
  src: string;
  alt: string;
  kind: "nominal" | "cover";
};

export function resolveProductAsset(
  game: Game,
  item?: GamePackage,
): ResolvedProductAsset | null {
  const product = findProduct(game);
  if (!product) return null;

  if (item) {
    const nominal = findNominalAsset(product, item);
    if (!nominal) return null;

    return {
      src: nominal.localPath,
      alt: nominal.alt ?? item.label,
      kind: "nominal",
    };
  }

  const cover =
    product.cover ||
    product.assets.find((asset) => asset.kind === "cover")?.localPath;
  if (!cover) return null;

  return {
    src: cover,
    alt: product.name,
    kind: "cover",
  };
}

export function resolveProductCover(game: Game) {
  return resolveProductAsset(game);
}
