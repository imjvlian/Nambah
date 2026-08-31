import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ICONIFY_SEARCH_URL = "https://api.iconify.design/search";
const ICONIFY_ICON_URL = "https://api.iconify.design";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details";
const CACHE_SECONDS = 60 * 60 * 24 * 7;

const PLAY_STORE_PACKAGES: Array<{ aliases: string[]; packageId: string }> = [
  { aliases: ["mobile legends", "mobile legends bang bang", "mlbb"], packageId: "com.mobile.legends" },
  { aliases: ["free fire", "garena free fire"], packageId: "com.dts.freefireth" },
  { aliases: ["pubg mobile", "pubg"], packageId: "com.tencent.ig" },
  { aliases: ["honor of kings", "hok"], packageId: "com.levelinfinite.sgameGlobal" },
  { aliases: ["genshin impact", "genshin"], packageId: "com.miHoYo.GenshinImpact" },
  { aliases: ["honkai star rail", "star rail", "hsr"], packageId: "com.HoYoverse.hkrpgoversea" },
  { aliases: ["zenless zone zero", "zzz"], packageId: "com.HoYoverse.Nap" },
  { aliases: ["wuthering waves", "wuwa"], packageId: "com.kurogame.wutheringwaves.global" },
  { aliases: ["roblox"], packageId: "com.roblox.client" },
  { aliases: ["steam", "steam wallet"], packageId: "com.valvesoftware.android.steam.community" },
  { aliases: ["wild rift", "league of legends wild rift"], packageId: "com.riotgames.league.wildrift" },
  { aliases: ["call of duty mobile", "cod mobile", "codm"], packageId: "com.activision.callofduty.shooter" },
  { aliases: ["efootball", "pes mobile"], packageId: "jp.konami.pesam" },
  { aliases: ["fc mobile", "fifa mobile"], packageId: "com.ea.gp.fifamobile" },
  { aliases: ["clash of clans", "coc"], packageId: "com.supercell.clashofclans" },
  { aliases: ["clash royale"], packageId: "com.supercell.clashroyale" },
  { aliases: ["brawl stars"], packageId: "com.supercell.brawlstars" },
  { aliases: ["pokemon go"], packageId: "com.nianticlabs.pokemongo" },
  { aliases: ["minecraft"], packageId: "com.mojang.minecraftpe" },
  { aliases: ["arena breakout"], packageId: "com.proximabeta.mf.uamo" },
  { aliases: ["delta force"], packageId: "com.proxima.dfm" },
  { aliases: ["spotify"], packageId: "com.spotify.music" },
  { aliases: ["netflix"], packageId: "com.netflix.mediaclient" },
  { aliases: ["youtube"], packageId: "com.google.android.youtube" },
  { aliases: ["discord"], packageId: "com.discord" },
  { aliases: ["canva"], packageId: "com.canva.editor" },
  { aliases: ["capcut"], packageId: "com.lemon.lvoverseas" },
  { aliases: ["tiktok"], packageId: "com.zhiliaoapp.musically" },
  { aliases: ["apple music"], packageId: "com.apple.android.music" },
  { aliases: ["xbox"], packageId: "com.microsoft.xboxone.smartglass" },
  { aliases: ["playstation", "playstation store"], packageId: "com.scee.psxandroid" },
  { aliases: ["nintendo switch online"], packageId: "com.nintendo.znca" },
  { aliases: ["dana"], packageId: "id.dana" },
  { aliases: ["ovo"], packageId: "ovo.id" },
  { aliases: ["gopay", "gojek"], packageId: "com.gojek.app" },
  { aliases: ["shopee", "shopeepay"], packageId: "com.shopee.id" },
  { aliases: ["linkaja"], packageId: "com.telkom.mwallet" },
];

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

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

function resolvePlayStorePackage(name: string) {
  const normalized = normalize(name);
  const exact = PLAY_STORE_PACKAGES.find((entry) =>
    entry.aliases.some((alias) => normalize(alias) === normalized),
  );
  if (exact) return exact.packageId;

  const contained = PLAY_STORE_PACKAGES.find((entry) =>
    entry.aliases.some((alias) => {
      const normalizedAlias = normalize(alias);
      return normalizedAlias.length >= 4 && normalized.includes(normalizedAlias);
    }),
  );
  return contained?.packageId ?? null;
}

function extractMetaContent(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

async function findPlayStoreIcon(name: string) {
  const packageId = resolvePlayStorePackage(name);
  if (!packageId) return null;

  const url = new URL(PLAY_STORE_URL);
  url.searchParams.set("id", packageId);
  url.searchParams.set("hl", "id");
  url.searchParams.set("gl", "ID");

  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    },
    next: { revalidate: CACHE_SECONDS },
  });

  if (!response.ok) return null;
  const html = await response.text();
  const image = extractMetaContent(html, "og:image");
  if (!image || !/^https:\/\//i.test(image)) return null;
  return image;
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

async function findSoftwareIcon(name: string) {
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
    const playStoreIcon = await findPlayStoreIcon(name);
    if (playStoreIcon) {
      return NextResponse.redirect(playStoreIcon, {
        status: 307,
        headers: {
          "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
          "X-Nambah-Icon-Source": "play-store",
        },
      });
    }

    const softwareIcon = await findSoftwareIcon(name);
    if (softwareIcon) {
      return NextResponse.redirect(softwareIcon, {
        status: 307,
        headers: {
          "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
          "X-Nambah-Icon-Source": "software-icon",
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
      "X-Nambah-Icon-Source": "fallback",
    },
  });
}
