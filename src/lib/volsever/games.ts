/**
 * Peta game Nambah -> route slug Volsever Game ID Checker.
 *
 * DASARNYA DI KODE, BUKAN DI ENV. `.env.local` tidak masuk git, jadi kalau
 * pemetaan hanya hidup di `VOLSEVER_GAME_ROUTES_JSON`, setiap deploy atau
 * mesin baru akan kehilangan semua mapping tanpa ada yang memberi tahu — dan
 * gejalanya hanya "Auto-check belum dikonfigurasi" di halaman checkout.
 *
 * Env tetap berguna untuk game yang belum ada di sini, dan untuk override
 * kalau Volsever mengganti slug.
 *
 * Hanya slug yang health check Volsever menyatakan `ok` yang dicantumkan.
 * `state-of-survival` dan `nba-infinite` sengaja TIDAK ada: keduanya ada di
 * Volsever tapi sedang berstatus `fail`, dan mengaktifkannya hanya membuat
 * pelanggan melihat error tanpa pernah mendapat nickname.
 *
 * Sumber: https://volsever.com/health-check (diambil 2026-10-08).
 */

export const DEFAULT_VOLSEVER_ROUTES: Readonly<Record<string, string>> = {
  "call-of-duty-mobile": "call-of-duty-mobile-indonesia",
  "arena-of-valor": "arena-of-valor-indonesia",
  "fc-mobile": "ea-sports-fc-mobile-indonesia",
  "heroes-evolved": "heroes-evolved",
  "honkai-star-rail": "honkai-star-rail",
  "league-of-legends": "league-of-legends",
  "league-of-legends-wild-rift": "league-of-legends-wild-rift",
  "legends-of-runeterra": "legends-of-runeterra",
  "valorant": "valorant-indonesia",
  "delta-force": "delta-force",
  "genshin-impact": "genshin-impact",
  "magic-chess": "magic-chess-go-go",
  "wuthering-waves": "wuthering-waves",
  "where-winds-meet": "where-winds-meet",
  "zenless-zone-zero": "zenless-zone-zero",
};

/** Slug Volsever yang tercatat `fail` — jangan dipakai sampai dikonfirmasi ulang. */
export const UNKNOWN_VOLSEVER_ROUTES: readonly string[] = [
  "state-of-survival",
  "nba-infinite",
];

const SLUG_PATTERN = /^[a-z0-9-]+$/i;

/**
 * Resolve route slug untuk satu game.
 *
 * Urutan: override dari env dulu, lalu peta bawaan. Env menang supaya
 * penambahan game baru tidak butuh deploy.
 */
export function resolveVolseverRoute(
  gameId: string,
  envRoutes?: Record<string, unknown> | null,
): string | null {
  const override = envRoutes?.[gameId];
  if (typeof override === "string" && SLUG_PATTERN.test(override.trim())) {
    return override.trim();
  }

  const fallback = DEFAULT_VOLSEVER_ROUTES[gameId];
  return fallback ?? null;
}

/** Daftar game yang punya route Volsever. Dipakai readiness check. */
export function gamesWithVolseverRoute(
  envRoutes?: Record<string, unknown> | null,
) {
  const ids = new Set(Object.keys(DEFAULT_VOLSEVER_ROUTES));
  for (const [gameId, value] of Object.entries(envRoutes ?? {})) {
    if (typeof value === "string" && SLUG_PATTERN.test(value.trim())) {
      ids.add(gameId);
    }
  }
  return [...ids].sort();
}

/** Parse `VOLSEVER_GAME_ROUTES_JSON`. Nilai rusak diabaikan, bukan fatal. */
export function parseVolseverRoutesEnv(raw: string | undefined): Record<string, unknown> | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}