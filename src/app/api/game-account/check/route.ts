import { createHash, randomUUID } from "node:crypto";
import { getGameAccountSchema, validateGameAccountTarget } from "@/lib/game-account";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  requires_server: boolean;
  active: boolean;
};

type MimihQuota = {
  plan?: string | null;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  expires_at?: string | null;
};

type MimihRegionData = {
  ref_id?: string;
  status?: string;
  nickname?: string | null;
  region?: string | null;
  country_code?: string | null;
  allowed_product_types?: string[];
  cached?: boolean;
  sandbox?: boolean;
  quota?: MimihQuota | null;
  rc?: string | number;
  message?: string;
};

type MimihRegionResponse = {
  data?: MimihRegionData;
  message?: string;
};

type CachedAccount = {
  nickname: string;
  server: string;
  region: string | null;
  countryCode: string | null;
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
  const username = process.env.GEMPAY_API_USERNAME?.trim() ?? "";
  const secret = process.env.GEMPAY_API_SECRET?.trim() ?? "";
  return { username, secret };
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
    let payload: MimihRegionResponse;

    try {
      payload = raw ? (JSON.parse(raw) as MimihRegionResponse) : {};
    } catch {
      return {
        httpStatus: response.status,
        data: undefined,
        parseError: true,
      };
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

function businessError(rc: string, message?: string) {
  switch (rc) {
    case "40":
      return Response.json(
        { error: "Format request pengecekan akun ditolak provider.", source: "mimih" },
        { status: 400 },
      );
    case "41":
      return Response.json(
        {
          error: "Kredensial API Mimih Market belum valid. Periksa username, secret, dan status key.",
          source: "mimih",
        },
        { status: 503 },
      );
    case "42":
      return Response.json(
        {
          error: "IP server Nambah belum diizinkan di API Mimih Market.",
          source: "mimih",
        },
        { status: 503 },
      );
    case "43":
      return Response.json(
        {
          error: "Batas request username checker sedang tercapai. Coba lagi sebentar.",
          retryable: true,
          source: "mimih",
        },
        { status: 429 },
      );
    case "53":
      return Response.json(
        {
          error: "Provider validasi akun sedang tidak tersedia. Checkout tetap bisa dilanjutkan.",
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
    case "57":
      return Response.json(
        {
          error: "Paket API Cek Region Mimih Market belum aktif pada key produksi.",
          source: "mimih",
        },
        { status: 503 },
      );
    case "58":
      return Response.json(
        {
          error: "Kuota API Cek Region Mimih Market sudah habis.",
          source: "mimih",
        },
        { status: 503 },
      );
    case "99":
      return Response.json(
        {
          error: "Hasil pengecekan belum pasti. Coba lagi beberapa saat.",
          retryable: true,
          source: "mimih",
        },
        { status: 503 },
      );
    default:
      return Response.json(
        {
          error: message?.trim() || "Pengecekan akun gagal diproses oleh provider.",
          source: "mimih",
        },
        { status: 502 },
      );
  }
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Konfigurasi database Nambah belum lengkap." },
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

  if (!gameId) {
    return Response.json({ error: "Game wajib diisi." }, { status: 400 });
  }

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(gameId)) {
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

  if (schema.checker !== "mobile-legends") {
    return Response.json(
      { error: "Auto check saat ini baru tersedia untuk Mobile Legends." },
      { status: 422 },
    );
  }

  const account = validateGameAccountTarget(gameDescriptor, rawUserId, rawServerId);
  if (!account.ok) {
    return Response.json({ error: account.error }, { status: 400 });
  }

  const userId = account.userId;
  const serverId = account.serverId;
  if (!serverId) {
    return Response.json({ error: "Zone ID wajib diisi." }, { status: 400 });
  }

  const { username, secret } = getMimihCredentials();
  if (!username || !secret) {
    return Response.json(
      {
        error: "API Cek Region Mimih Market belum dikonfigurasi di server Nambah.",
        source: "mimih",
      },
      { status: 503 },
    );
  }

  const cacheKey = `${game.id}:${userId}:${serverId}`;
  const cached = accountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({
      nickname: cached.nickname,
      server: cached.server,
      region: cached.region,
      countryCode: cached.countryCode,
      cached: true,
      source: "mimih",
    });
  }
  if (cached) accountCache.delete(cacheKey);

  if (rateLimitExceeded(getClientKey(request))) {
    return Response.json(
      { error: "Terlalu banyak pengecekan akun. Coba lagi beberapa menit." },
      { status: 429 },
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

    if (result.parseError) {
      return Response.json(
        {
          error: "API Mimih Market mengembalikan response yang tidak dapat dibaca.",
          retryable: true,
          source: "mimih",
        },
        { status: 503 },
      );
    }

    if (result.httpStatus >= 500) {
      return Response.json(
        {
          error: "API Mimih Market sedang mengalami gangguan sementara.",
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
          message: data?.message?.trim() || "Pengecekan akun masih diproses.",
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
      return businessError(rc, data?.message);
    }

    pendingChecks.delete(cacheKey);

    const nickname = data?.nickname?.trim() ?? "";
    if (!nickname) {
      return Response.json(
        {
          error: "Akun ditemukan, tetapi nickname tidak tersedia dari provider.",
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
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return Response.json({
      nickname,
      server: serverId,
      region,
      countryCode,
      allowedProductTypes: data?.allowed_product_types ?? [],
      providerCached: Boolean(data?.cached),
      cached: false,
      source: "mimih",
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
        error: "Tidak bisa terhubung ke API Cek Region Mimih Market.",
        retryable: true,
        source: "mimih",
      },
      { status: 503 },
    );
  }
}
