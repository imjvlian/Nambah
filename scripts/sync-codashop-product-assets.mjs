import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, "public", "product-assets", "codashop");
const ASSET_ROOT = path.join(OUTPUT_ROOT, "_assets");
const MANIFEST_PATH = path.join(OUTPUT_ROOT, "manifest.json");
const REPORT_PATH = path.join(OUTPUT_ROOT, "sync-report.json");

const HOMEPAGES = [
  "https://www.codashop.com/id-id/",
  "https://app.codashop.com/id-id/",
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36 NambahAssetSync/1.0";
const PAGE_CONCURRENCY = 4;
const ASSET_CONCURRENCY = 8;
const PAGE_TIMEOUT_MS = 20_000;
const ASSET_TIMEOUT_MS = 25_000;
const MAX_PRODUCTS = Number(process.env.CODASHOP_ASSET_MAX_PRODUCTS || 500);

const EXCLUDED_SLUG_PREFIXES = [
  "user/",
  "checkout",
  "order",
  "search",
  "about",
  "contact",
  "terms",
  "privacy",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function slugFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith("/id-id/")) return null;
    const slug = parsed.pathname.slice("/id-id/".length).replace(/^\/+|\/+$/g, "");
    if (!slug || EXCLUDED_SLUG_PREFIXES.some((prefix) => slug.startsWith(prefix))) return null;
    return slug;
  } catch {
    return null;
  }
}

function normalizeProductUrl(raw) {
  const decoded = decodeHtml(raw).trim();
  if (!decoded) return null;

  try {
    const url = decoded.startsWith("http")
      ? new URL(decoded)
      : new URL(decoded, "https://www.codashop.com");
    if (!/^(www|app)\.codashop\.com$/i.test(url.hostname)) return null;
    const slug = slugFromUrl(url.toString());
    if (!slug) return null;
    url.protocol = "https:";
    url.hostname = "www.codashop.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function extractProductLinks(html) {
  const normalized = decodeHtml(html);
  const links = new Set();
  const regex = /(?:href|url)[=:]["']?([^"'<>\s]+)["']?/gi;
  let match;
  while ((match = regex.exec(normalized))) {
    const url = normalizeProductUrl(match[1]);
    if (url) links.add(url);
  }

  const plainRegex = /https:\/\/(?:www|app)\.codashop\.com\/id-id\/[a-z0-9][a-z0-9/_-]*/gi;
  while ((match = plainRegex.exec(normalized))) {
    const url = normalizeProductUrl(match[0]);
    if (url) links.add(url);
  }

  return [...links];
}

function extractTitle(html, fallback) {
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  if (h2) {
    const value = stripTags(h2);
    if (value) return value;
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const value = stripTags(title || "").replace(/\s*[-|]\s*Codashop.*$/i, "").trim();
  return value || fallback;
}

function classifyAsset(url) {
  const clean = url.toLowerCase();
  if (clean.includes("/product-tiles/")) return "cover";
  if (/\/images\/[^/]+_product\//i.test(clean)) return "nominal";
  if (/\/images\/[^/]+_image\//i.test(clean)) return "nominal";
  return null;
}

function normalizeAssetUrl(raw) {
  const decoded = decodeHtml(raw).replace(/[),;]+$/, "");
  try {
    const url = new URL(decoded);
    if (url.hostname !== "cdn1.codashop.com") return null;
    if (!classifyAsset(url.toString())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function getAttr(tag, attr) {
  const match = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? stripTags(match[1]) : "";
}

function extractAssets(html) {
  const normalized = decodeHtml(html);
  const byUrl = new Map();

  const imgRegex = /<img\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = imgRegex.exec(normalized))) {
    const tag = tagMatch[0];
    const alt = getAttr(tag, "alt");
    const candidates = [getAttr(tag, "src"), getAttr(tag, "data-src"), getAttr(tag, "srcset")]
      .flatMap((value) => value.split(/\s*,\s*|\s+/))
      .filter(Boolean);

    for (const candidate of candidates) {
      const url = normalizeAssetUrl(candidate);
      if (!url) continue;
      const existing = byUrl.get(url);
      if (!existing || (!existing.alt && alt)) {
        byUrl.set(url, { sourceUrl: url, alt, kind: classifyAsset(url) });
      }
    }
  }

  const urlRegex = /https:\/\/cdn1\.codashop\.com\/[A-Za-z0-9_./%?=&:+~-]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'<>\s]*)?/gi;
  let match;
  while ((match = urlRegex.exec(normalized))) {
    const url = normalizeAssetUrl(match[0]);
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, { sourceUrl: url, alt: "", kind: classifyAsset(url) });
  }

  return [...byUrl.values()];
}

async function fetchWithRetry(url, { timeoutMs, binary = false } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || PAGE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: binary ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" : "text/html,application/xhtml+xml",
          "User-Agent": USER_AGENT,
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
          Referer: "https://www.codashop.com/id-id/",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

function extensionFrom(url, contentType = "") {
  const pathname = new URL(url).pathname.toLowerCase();
  const ext = path.extname(pathname);
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  return ".jpg";
}

async function loadPreviousManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(ASSET_ROOT, { recursive: true });
  const startedAt = new Date().toISOString();
  const homepageErrors = [];
  const discovered = new Set();

  for (const homepage of HOMEPAGES) {
    try {
      const html = await fetchWithRetry(homepage, { timeoutMs: PAGE_TIMEOUT_MS });
      for (const url of extractProductLinks(html)) discovered.add(url);
    } catch (error) {
      homepageErrors.push({ url: homepage, error: String(error) });
    }
  }

  const productUrls = [...discovered].sort().slice(0, MAX_PRODUCTS);
  console.log(`Discovered ${productUrls.length} Codashop Indonesia product pages.`);

  const productFailures = [];
  const products = (
    await mapConcurrent(productUrls, PAGE_CONCURRENCY, async (pageUrl, index) => {
      const slug = slugFromUrl(pageUrl);
      try {
        if (index > 0) await sleep(80);
        const html = await fetchWithRetry(pageUrl, { timeoutMs: PAGE_TIMEOUT_MS });
        const assets = extractAssets(html);
        if (!assets.length) return null;
        return {
          slug,
          name: extractTitle(html, slug),
          pageUrl,
          assets,
        };
      } catch (error) {
        productFailures.push({ pageUrl, error: String(error) });
        return null;
      }
    })
  ).filter(Boolean);

  const assetSources = new Map();
  for (const product of products) {
    for (const asset of product.assets) {
      const entry = assetSources.get(asset.sourceUrl) || { ...asset, products: [] };
      entry.products.push(product.slug);
      if (!entry.alt && asset.alt) entry.alt = asset.alt;
      assetSources.set(asset.sourceUrl, entry);
    }
  }

  console.log(`Found ${assetSources.size} unique product asset URLs across ${products.length} products.`);

  const downloadFailures = [];
  const downloaded = await mapConcurrent([...assetSources.values()], ASSET_CONCURRENCY, async (asset) => {
    try {
      const buffer = await fetchWithRetry(asset.sourceUrl, {
        timeoutMs: ASSET_TIMEOUT_MS,
        binary: true,
      });
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const ext = extensionFrom(asset.sourceUrl);
      const fileName = `${sha256.slice(0, 20)}${ext}`;
      const localFile = path.join(ASSET_ROOT, fileName);
      await writeFile(localFile, buffer);
      return {
        ...asset,
        sha256,
        localPath: `/product-assets/codashop/_assets/${fileName}`,
        bytes: buffer.byteLength,
      };
    } catch (error) {
      downloadFailures.push({ sourceUrl: asset.sourceUrl, error: String(error) });
      return null;
    }
  });

  const downloadedByUrl = new Map(downloaded.filter(Boolean).map((item) => [item.sourceUrl, item]));
  const manifestProducts = {};
  const uniqueContentHashes = new Set();
  let totalBytes = 0;

  for (const product of products) {
    const assets = product.assets
      .map((asset) => downloadedByUrl.get(asset.sourceUrl))
      .filter(Boolean)
      .map((asset) => {
        uniqueContentHashes.add(asset.sha256);
        totalBytes += asset.bytes;
        return {
          alt: asset.alt || null,
          kind: asset.kind,
          sourceUrl: asset.sourceUrl,
          localPath: asset.localPath,
          sha256: asset.sha256,
          bytes: asset.bytes,
        };
      });
    if (!assets.length) continue;
    manifestProducts[product.slug] = {
      name: product.name,
      pageUrl: product.pageUrl,
      cover: assets.find((asset) => asset.kind === "cover")?.localPath || null,
      assets,
    };
  }

  const previous = await loadPreviousManifest();
  const manifest = {
    version: 1,
    source: "Codashop Indonesia public product catalog",
    sourceHomepages: HOMEPAGES,
    generatedAt: new Date().toISOString(),
    previousGeneratedAt: previous?.generatedAt || null,
    stats: {
      discoveredProductPages: productUrls.length,
      productsWithAssets: Object.keys(manifestProducts).length,
      uniqueSourceUrls: downloadedByUrl.size,
      uniqueContentFiles: uniqueContentHashes.size,
      totalReferencedBytes: totalBytes,
    },
    products: manifestProducts,
  };

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    stats: manifest.stats,
    homepageErrors,
    productFailures,
    downloadFailures,
  };

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report.stats, null, 2));
  if (downloadFailures.length) console.warn(`Asset download failures: ${downloadFailures.length}`);
  if (productFailures.length) console.warn(`Product page failures: ${productFailures.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
