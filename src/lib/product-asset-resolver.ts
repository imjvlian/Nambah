import manifestJson from "../../public/product-assets/codashop/manifest.json";
import type { Game, GamePackage } from "@/lib/catalog";

type ProductAsset = {
  alt: string;
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

const manifest = manifestJson as ProductAssetManifest;

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
]);

const PRODUCT_ALIASES: Record<string, string[]> = {
  "mobile-legends": ["mobile legends", "mobile legends bang bang", "mlbb"],
  "free-fire": ["free fire", "garena free fire", "ff"],
  "pubg-mobile": ["pubg mobile", "playerunknown battleground mobile", "pubg"],
  valorant: ["valorant", "valorant points", "vp"],
  "honor-of-kings": ["honor of kings", "hok"],
  "genshin-impact": ["genshin impact", "genshin"],
  roblox: ["roblox", "robux"],
  "steam-wallet": ["steam wallet", "steam"],
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

function tokens(value: string) {
  return normalize(value)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function numericTokens(value: string) {
  return normalize(value).match(/\d+/g) ?? [];
}

function productCandidates(game: Game) {
  const aliases = PRODUCT_ALIASES[game.id] ?? [];
  return [game.id, game.name, game.shortName, ...aliases]
    .map(normalize)
    .filter(Boolean);
}

function scoreProduct(game: Game, slug: string, product: ProductAssetEntry) {
  const candidates = productCandidates(game);
  const slugNormalized = normalize(slug);
  const nameNormalized = normalize(product.name);
  const slugCompact = compact(slug);
  const nameCompact = compact(product.name);

  let score = 0;
  for (const candidate of candidates) {
    const candidateCompact = candidate.replace(/\s+/g, "");

    if (slugNormalized === candidate || nameNormalized === candidate) score = Math.max(score, 120);
    if (slugCompact === candidateCompact || nameCompact === candidateCompact) score = Math.max(score, 115);
    if (slugNormalized.includes(candidate) || nameNormalized.includes(candidate)) score = Math.max(score, 95);
    if (candidate.includes(slugNormalized) || candidate.includes(nameNormalized)) score = Math.max(score, 85);
  }

  const gameTokens = new Set(tokens(`${game.name} ${game.shortName}`));
  const productTokens = new Set(tokens(`${slug} ${product.name}`));
  const overlap = [...gameTokens].filter((token) => productTokens.has(token)).length;
  score += overlap * 8;

  return score;
}

function findProduct(game: Game) {
  let best: { slug: string; product: ProductAssetEntry; score: number } | null = null;

  for (const [slug, product] of Object.entries(manifest.products)) {
    const score = scoreProduct(game, slug, product);
    if (!best || score > best.score) best = { slug, product, score };
  }

  return best && best.score >= 70 ? best.product : null;
}

function specialIntent(value: string) {
  const normalized = normalize(value);
  if (/weekly diamond pass|weekly pass/.test(normalized)) return ["weekly", "diamond", "pass"];
  if (/weekly membership/.test(normalized)) return ["weekly", "membership"];
  if (/monthly membership/.test(normalized)) return ["monthly", "membership"];
  if (/welkin/.test(normalized)) return ["welkin"];
  if (/twilight pass/.test(normalized)) return ["twilight", "pass"];
  if (/starlight/.test(normalized)) return ["starlight"];
  if (/booyah pass/.test(normalized)) return ["booyah", "pass"];
  if (/battle pass/.test(normalized)) return ["battle", "pass"];
  if (/first top up|first topup|first recharge|double diamond/.test(normalized)) {
    return ["first", "top", "up", "double"];
  }
  return [];
}

function scoreAsset(item: GamePackage, asset: ProductAsset) {
  if (asset.kind !== "nominal") return -1;

  const label = normalize(item.label);
  const alt = normalize(asset.alt || "");
  if (!alt) return 0;

  if (label === alt) return 200;
  if (compact(label) === compact(alt)) return 195;

  let score = 0;
  const labelNumbers = numericTokens(label);
  const altNumbers = numericTokens(alt);

  if (labelNumbers.length > 0) {
    const exactNumeric =
      labelNumbers.length === altNumbers.length &&
      labelNumbers.every((value, index) => value === altNumbers[index]);
    if (exactNumeric) score += 70;
    else if (labelNumbers.some((value) => altNumbers.includes(value))) score += 32;
    else score -= 24;
  }

  const labelTokens = new Set(tokens(label));
  const altTokens = new Set(tokens(alt));
  const overlap = [...labelTokens].filter((token) => altTokens.has(token)).length;
  score += overlap * 18;

  const intent = specialIntent(label);
  if (intent.length > 0) {
    const intentMatches = intent.filter((token) => alt.includes(token)).length;
    score += intentMatches * 24;
    if (intentMatches === 0) score -= 35;
  }

  if (alt.includes(label) || label.includes(alt)) score += 30;

  return score;
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
    let best: { asset: ProductAsset; score: number } | null = null;
    for (const asset of product.assets) {
      const score = scoreAsset(item, asset);
      if (!best || score > best.score) best = { asset, score };
    }

    if (best && best.score >= 28) {
      return {
        src: best.asset.localPath,
        alt: best.asset.alt || item.label,
        kind: "nominal",
      };
    }
  }

  const cover = product.cover || product.assets.find((asset) => asset.kind === "cover")?.localPath;
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
