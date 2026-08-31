import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ICONIFY_SEARCH_URL = "https://api.iconify.design/search";
const ICONIFY_ICON_URL = "https://api.iconify.design";
const CACHE_SECONDS = 60 * 60 * 24 * 7;

const PREFIX_SCORE: Record<string, number> = {
  arcticons: 130,
  "simple-icons": 120,
  logos: 110,
  "skill-icons": 80,
  devicon: 70,
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

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function initials(value: string) {
  const words = normalize(value).split(" ").filter(Boolean);
  if (words.length >= 2) return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
  return (words[0] ?? "NA").slice(0, 2).toUpperCase();
}

function fallbackSvg(name: string) {
  const label = escapeXml(initials(name));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${escapeXml(name)}">
  <rect width="128" height="128" rx="28" fill="#171a16"/>
  <rect x="1" y="1" width="126" height="126" rx="27" fill="none" stroke="#343a31" stroke-width="2"/>
  <text x="64" y="72" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#c9ff3f">${label}</text>
</svg>`;
}

function iconScore(icon: string, query: string) {
  const [prefix = "", rawName = ""] = icon.split(":", 2);
  const name = normalize(rawName);
  const queryNormalized = normalize(query);
  const nameCompact = compact(rawName);
  const queryCompact = compact(query);
  const words = queryNormalized.split(" ").filter((word) => word.length >= 2);

  let score = PREFIX_SCORE[prefix] ?? 0;
  if (nameCompact === queryCompact) score += 180;
  if (name === queryNormalized) score += 160;
  if (nameCompact.includes(queryCompact)) score += 90;
  if (queryCompact.includes(nameCompact) && nameCompact.length >= 4) score += 40;

  const matchedWords = words.filter((word) => name.includes(word)).length;
  score += matchedWords * 24;
  if (words.length > 0 && matchedWords === words.length) score += 80;

  if (/outline|round|square|circle|logo-type|wordmark/i.test(rawName)) score -= 12;
  return score;
}

async function findIcon(name: string) {
  const url = new URL(ICONIFY_SEARCH_URL);
  url.searchParams.set("query", name);
  url.searchParams.set("limit", "64");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: CACHE_SECONDS },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { icons?: string[] };
  const icons = Array.isArray(data.icons) ? data.icons : [];
  if (icons.length === 0) return null;

  const ranked = icons
    .map((icon) => ({ icon, score: iconScore(icon, name) }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best || best.score < 120) return null;

  const [prefix, iconName] = best.icon.split(":", 2);
  if (!prefix || !iconName) return null;
  return `${ICONIFY_ICON_URL}/${encodeURIComponent(prefix)}/${encodeURIComponent(iconName)}.svg`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 100);

  if (!name) {
    return new NextResponse(fallbackSvg("Nambah"), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
      },
    });
  }

  try {
    const iconUrl = await findIcon(name);
    if (iconUrl) {
      return NextResponse.redirect(iconUrl, {
        status: 307,
        headers: {
          "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
        },
      });
    }
  } catch (error) {
    console.warn("Game icon lookup failed", name, error);
  }

  return new NextResponse(fallbackSvg(name), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
    },
  });
}
