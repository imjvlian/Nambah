import { createHash, randomUUID } from "node:crypto";
import {
  readCachedAccountCheck,
  writeCachedAccountCheck,
} from "@/lib/account-check-cache";
import { getGameAccountSchema, validateGameAccountTarget } from "@/lib/game-account";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";
import { checkVolseverGame } from "@/lib/volsever/client";
import {
  parseVolseverRoutesEnv,
  resolveVolseverRoute,
} from "@/lib/volsever/games";
import { rateLimitResponse } from "@/lib/rate-limit";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  requires_server: boolean;
  active: boolean;
};

type MimihRegionData = {
  nickname?: string | null;
  region?: string | null;
  country_code?: string | null;
  allowed_product_types?: string[];
  cached?: boolean;
  rc?: string | number;
  message?: string;
};

type MimihRegionResponse = {
  data?: MimihRegionData;
};

type CachedAccount = {
  nickname: string;
  server: string;
  region: string | null;
  countryCode: string | null;
  source: "volsever" | "mimih";
  expiresAt: number;
};

type PendingAccount = {
  refId: string;
  startedAt: number;
};

const MIMIH_REGION_URL = "https://mimihmarket.com/api/v1/ml-region";
const CACHE_TTL_MS = 15 * 60 * 1000;
const PENDING_TTL_MS = 2 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const CHECK_TIMEOUT_MS = 12_000;

function configuredVolseverRoute(gameId: string) {
  return resolveVolseverRoute(
    gameId,
    parseVolseverRoutesEnv(process.env.VOLSEVER_GAME_ROUTES_JSON),
  );
}

const accountCache = new Map<string, CachedAccount>();
const pendingChecks = new Map<string, PendingAccount>();
const rateLimits = new Map<string, number[]>();

function normalizeRc(value: string | number | undefined) {
  if (value === undefined || value === null) return "";
  return String(value).trim().padStart(2, "0");
}

function getClientKey(request: Request) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

function rateLimitExceeded(clientKey: string) {
  const now = Date.now();
  const recent = (rateLimits.get(clientKey) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimits.set(clientKey, recent);
    return true;
  }

  recent.push(now);
  rateLimits.set(clientKey, recent);
  return false;
}

function getMimihCredentials() {
  return {
    username: process.env.GEMPAY_API_USERNAME?.trim() ?? "",
    secret: process.env.GEMPAY_API_SECRET?.trim() ?? "",
  };
}

function makeRefId() {
  return `nmb-ml-${Date.now().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function makeSignature(username: string, secret: string, refId: string) {
  return createHash("md5")
    .update(`${username}${secret}${refId}`, "utf8")
    .digest("hex");
}

async function callMimihRegionApi(input: {
  username: string;
  secret: string;
  refId: string;
  userId: string;
  serverId: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(MIMIH_REGION_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: input.username,
        ref_id: input.refId,
        sign: makeSignature(input.username, input.secret, input.refId),
        user_id: input.userId,
        zone_id: input.serverId,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: MimihRegionResponse = {};
    try {
      payload = raw ? (JSON.parse(raw) as MimihRegionResponse) : {};
    } catch {
      return { httpStatus: response.status, data: undefined, parseError: true };
    }

    return {
      httpStatus: response.status,
      data: payload.data,
      parseError: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function mimihBusinessError(rc: string, message?: string) {
  // `rc` dan `message` mentah dari provider hanya boleh masuk ke server log.
  // User menerima teks generik supaya tidak melihat detail integrasi internal.
  switch (rc) {
    case "40":
      return Response.json(
        { error: "Data akun yang dimasukkan belum tepat. Periksa ID dan Zone kamu.", source: "mimih" },
        { status: 400 },
      );
    case "41":
    case "42":
    case "57":
    case "58":
      console.error(`Mimih account checker unavailable (rc=${rc})`, message);
      return Response.json(
        {
          error: "Pengecekan akun sedang tidak tersedia. Kamu tetap bisa checkout tanpa cek otomatis.",
          retryable: true,
          source: "mimih",
        },
        { status: 503 },
      );
    case "43":
      return Response.json(
        {
          error: "Batas request checker sedang tercapai. Coba lagi sebentar.",
          retryable: true,
          source: "mimih",
        },
        { status: 429 },
      );
    case "53":
    case "99":
      console.error(`Mimih account checker provider error (rc=${rc})`, message);
      return Response.json(
        {
          error: "Pengecekan akun sedang tidak tersedia. Checkout tetap bisa dilanjutkan.",
          retryable: true,
          source: "mimih",
        },
        { status: 503 },
      );
    case "54":
      return Response.json(
        {
          error: "User ID / Server tidak ditemukan. Periksa kembali data akun.",
          source: "mimih",
        },
        { status: 422 },
      );
    default:
      // Jangan pernah kirim `message` mentah provider ke user: isinya bisa
      // memuat teks teknis/URL endpoint internal pihak ketiga.
      console.error(`Mimih account checker unhandled rc=${rc}`, message);
      return Response.json(
        {
          error: "Pengecekan akun sedang mengalami gangguan. Silakan coba lagi sebentar.",
          retryable: true,
          source: "mimih",
        },
        { status: 502 },
      );
  }
}

export async function POST(request: Request) {
  const durableLimit = await rateLimitResponse(request, {
    scope: "game-account-check",
    limit: 30,
    windowSeconds: 10 * 60,
  });
  if (durableLimit) return durableLimit;

  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: `Konfigurasi database ${BRAND.shortName} belum lengkap.` },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request checker tidak valid." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request checker tidak valid." }, { status: 400 });
  }

  const payload = body as {
    gameId?: unknown;
    userId?: unknown;
    serverId?: unknown;
  };

  const gameId = typeof payload.gameId === "string" ? payload.gameId.trim() : "";
  const rawUserId = typeof payload.userId === "string" ? payload.userId : "";
  const rawServerId = typeof payload.serverId === "string" ? payload.serverId : "";

  if (!gameId || !/^[a-zA-Z0-9_-]{1,100}$/.test(gameId)) {
    return Response.json({ error: "Game ID tidak valid." }, { status: 400 });
  }

  const [game] = await supabaseSelect<GameRow>("games", {
    select: "id,name,short_name,requires_server,active",
    filters: { id: `eq.${gameId}`, active: "eq.true" },
    limit: 1,
  });

  if (!game) {
    return Response.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  const gameDescriptor = {
    id: game.id,
    name: game.name,
    shortName: game.short_name,
    requiresServer: game.requires_server,
  };
  const schema = getGameAccountSchema(gameDescriptor);

  const account = validateGameAccountTarget(
    gameDescriptor,
    rawUserId,
    rawServerId,
  );
  if (!account.ok) {
    return Response.json({ error: account.error }, { status: 400 });
  }

  if (!schema.checker) {
    return Response.json({
      verified: false,
      localOnly: true,
      message:
        "Format tujuan valid. Produk ini tidak memerlukan auto-check provider.",
    });
  }

  const userId = account.userId;
  const serverId = account.serverId;
  const isMobileLegends = schema.checker === "mobile-legends";
  const routeSlug = isMobileLegends
    ? "mobile-legends-wr"
    : configuredVolseverRoute(game.id);

  // Dua lapis cache SEBELUM provider eksternal, dan sebelum gate route di
  // bawah. Urutannya penting: gate route pernah berada di sini, sehingga
  // nickname yang sudah tersimpan di `account_check_cache` dibuang begitu
  // config Volsever berubah atau env-nya kosong — padahal tidak ada satu pun
  // request yang perlu dikirim untuk mengambilnya.
  // L1 = memory instance ini, L2 = table `account_check_cache` (durable,
  // bertahan lintas cold start dan dibagi antar instance).
  const cacheKey = `${game.id}:${userId}:${serverId ?? ""}`;
  const inMemory = accountCache.get(cacheKey);
  if (inMemory && inMemory.expiresAt > Date.now()) {
    return Response.json({
      nickname: inMemory.nickname,
      server: inMemory.server,
      region: inMemory.region,
      verified: true,
    });
  }
  if (inMemory) accountCache.delete(cacheKey);

  const stored = await readCachedAccountCheck(game.id, userId, serverId);
  if (stored) {
    // Warm L1 supaya request berikutnya di instance ini tidak perlu query DB.
    accountCache.set(cacheKey, {
      nickname: stored.nickname,
      server: stored.server ?? serverId ?? "",
      region: stored.region,
      countryCode: null,
      source: stored.provider,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return Response.json({
      nickname: stored.nickname,
      server: stored.server ?? serverId ?? null,
      region: stored.region,
      verified: true,
    });
  }

  if (!routeSlug) {
    return Response.json({
      verified: false,
      localOnly: true,
      server: serverId ?? null,
      message:
        "Format akun valid. Auto-check provider belum dikonfigurasi untuk produk ini.",
      source: "local",
    });
  }

  if (rateLimitExceeded(getClientKey(request))) {
    return Response.json(
      { error: "Terlalu banyak pengecekan akun. Coba lagi beberapa menit." },
      { status: 429 },
    );
  }

  let volseverUnavailable = false;
  try {
    const result = await checkVolseverGame({
      routeSlug,
      userId,
      ...(serverId ? { serverId } : {}),
    });

    if (result.configured && result.ok && result.nickname) {
      accountCache.set(cacheKey, {
        nickname: result.nickname,
        server: result.server ?? serverId ?? "",
        region: result.region,
        countryCode: result.countryCode,
        source: "volsever",
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      await writeCachedAccountCheck({
        gameId: game.id,
        userId,
        serverId,
        nickname: result.nickname,
        resolvedServer: result.server ?? serverId ?? null,
        region: result.region,
        provider: "volsever",
      });

      return Response.json({
        nickname: result.nickname,
        server: result.server ?? serverId ?? null,
        region: result.region,
        verified: true,
      });
    }

    if (result.configured && result.invalidAccount) {
      return Response.json(
        {
          error: "User ID / Zone ID tidak ditemukan. Periksa kembali data akun.",
          source: "volsever",
        },
        { status: 422 },
      );
    }

    volseverUnavailable = result.configured;
  } catch (error) {
    volseverUnavailable = true;
    console.error("Volsever account checker failed", error);
  }

  if (!isMobileLegends) {
    return Response.json(
      {
        verified: false,
        retryable: volseverUnavailable,
        localOnly: false,
        server: serverId ?? null,
        message:
          "Provider auto-check belum dapat memverifikasi akun. Format input tetap valid dan checkout dapat dilanjutkan.",
        source: "volsever",
      },
      { status: volseverUnavailable ? 503 : 200 },
    );
  }

  if (!serverId) {
    return Response.json(
      { error: "Zone ID wajib diisi untuk Mobile Legends." },
      { status: 400 },
    );
  }

  const { username, secret } = getMimihCredentials();
  if (!username || !secret) {
    return Response.json(
      {
        error: volseverUnavailable
          ? "Volsever sedang tidak tersedia dan fallback checker belum dikonfigurasi. Checkout tetap bisa dilanjutkan."
          : `Volsever belum dikonfigurasi. Tambahkan VOLSEVER_API_KEY di server ${BRAND.shortName}.`,
        retryable: volseverUnavailable,
        source: "volsever",
      },
      { status: 503 },
    );
  }

  const existingPending = pendingChecks.get(cacheKey);
  const pendingStillValid =
    existingPending && Date.now() - existingPending.startedAt < PENDING_TTL_MS;
  const refId = pendingStillValid ? existingPending.refId : makeRefId();
  if (existingPending && !pendingStillValid) pendingChecks.delete(cacheKey);

  try {
    const result = await callMimihRegionApi({
      username,
      secret,
      refId,
      userId,
      serverId,
    });

    if (result.parseError || result.httpStatus >= 500) {
      return Response.json(
        {
          error: "Checker akun sedang mengalami gangguan sementara. Checkout tetap bisa dilanjutkan.",
          retryable: true,
          source: "mimih",
        },
        { status: 503 },
      );
    }

    const data = result.data;
    const rc = normalizeRc(data?.rc);

    if (rc === "03") {
      pendingChecks.set(cacheKey, {
        refId,
        startedAt: existingPending?.startedAt ?? Date.now(),
      });
      return Response.json(
        {
          pending: true,
          message: "Pengecekan akun masih diproses.",
          source: "mimih",
        },
        { status: 202 },
      );
    }

    if (rc !== "00") {
      if (rc === "99") {
        pendingChecks.set(cacheKey, {
          refId,
          startedAt: existingPending?.startedAt ?? Date.now(),
        });
      } else {
        pendingChecks.delete(cacheKey);
      }
      return mimihBusinessError(rc, data?.message);
    }

    pendingChecks.delete(cacheKey);

    const nickname = data?.nickname?.trim() ?? "";
    if (!nickname) {
      return Response.json(
        {
          error: "Akun kamu terdeteksi, tapi nama panggilan belum bisa dimuat. Silakan coba lagi sebentar.",
          retryable: true,
          source: "mimih",
        },
        { status: 502 },
      );
    }

    const region = data?.region?.trim() || null;
    const countryCode = data?.country_code?.trim().toUpperCase() || null;

    accountCache.set(cacheKey, {
      nickname,
      server: serverId,
      region,
      countryCode,
      source: "mimih",
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    await writeCachedAccountCheck({
      gameId: game.id,
      userId,
      serverId,
      nickname,
      resolvedServer: serverId ?? null,
      region,
      provider: "mimih",
    });

    // Hanya field yang benar-benar dipakai UI yang dikirim ke browser. Detail
    // integrasi (provider fallback, cache hit, allowed product types, negara)
    // dicatat di server saja supaya rantai vendor tidak bocor ke user.
    return Response.json({
      nickname,
      server: serverId,
      region,
      verified: true,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return Response.json(
        {
          error: "Pengecekan akun timeout. Checkout tetap bisa dilanjutkan.",
          retryable: true,
          source: "mimih",
        },
        { status: 503 },
      );
    }

    console.error("Mimih Market account checker failed", error);
    return Response.json(
      {
        error: "Tidak bisa terhubung ke provider pengecekan akun. Checkout tetap bisa dilanjutkan.",
        retryable: true,
        source: "mimih",
      },
      { status: 503 },
    );
  }
}
