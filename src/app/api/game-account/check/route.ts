import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  requires_server: boolean;
  active: boolean;
};

type CodashopResponse = {
  success?: boolean;
  errorMsg?: string | null;
  errorCode?: string | number | null;
  RESULT_CODE?: string | number | null;
  confirmationFields?: {
    username?: string | null;
    roles?: Array<{ role?: string | null }>;
  };
  result?: string | null;
};

type CachedAccount = {
  nickname: string;
  server: string;
  expiresAt: number;
};

class AccountCheckError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = "AccountCheckError";
    this.status = status;
    this.retryable = retryable;
  }
}

const CODASHOP_CHECK_URL = "https://order-sg.codashop.com/initPayment.action";
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
const CHECK_TIMEOUT_MS = 10_000;

const accountCache = new Map<string, CachedAccount>();
const rateLimits = new Map<string, number[]>();

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function mobileLegendsPayload(userId: string, serverId: string) {
  return {
    "voucherPricePoint.id": 27684,
    "voucherPricePoint.price": 527250.0,
    "voucherPricePoint.variablePrice": 0,
    "user.userId": userId,
    "user.zoneId": serverId,
    voucherTypeName: "MOBILE_LEGENDS",
    lvtId: "",
    shopLang: "id_ID",
    dynamicSkuToken: "",
    pricePointDynamicSkuToken: "",
    voucherTypeId: "",
  };
}

async function checkMobileLegendsWithCodashop(userId: string, serverId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(CODASHOP_CHECK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: "https://www.codashop.com",
        Referer: "https://www.codashop.com/",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      },
      body: JSON.stringify(mobileLegendsPayload(userId, serverId)),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: CodashopResponse;

    try {
      payload = raw ? (JSON.parse(raw) as CodashopResponse) : {};
    } catch {
      throw new AccountCheckError(
        "Pengecekan akun sedang tidak tersedia. Coba lagi beberapa saat.",
        503,
        true,
      );
    }

    if (response.status === 429 || String(payload.RESULT_CODE ?? "") === "10001") {
      throw new AccountCheckError(
        "Pengecekan akun sedang mencapai batas request. Coba lagi sebentar.",
        429,
        true,
      );
    }

    if (String(payload.errorCode ?? "") === "-200") {
      throw new AccountCheckError(
        "ID ditemukan, tetapi Server / Zone tidak sesuai. Periksa kembali datanya.",
        422,
      );
    }

    if (!response.ok && response.status >= 500) {
      throw new AccountCheckError(
        "Pengecekan akun sedang mengalami gangguan sementara.",
        503,
        true,
      );
    }

    if (!payload.success || payload.errorMsg) {
      throw new AccountCheckError(
        "User ID / Server tidak ditemukan. Periksa kembali data akun.",
        422,
      );
    }

    const nickname =
      payload.confirmationFields?.username?.trim() ||
      payload.confirmationFields?.roles?.[0]?.role?.trim() ||
      payload.result?.trim() ||
      "";

    if (!nickname) {
      throw new AccountCheckError(
        "Akun terdeteksi, tetapi nickname tidak tersedia dari provider.",
        502,
        true,
      );
    }

    return { nickname };
  } catch (error) {
    if (error instanceof AccountCheckError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new AccountCheckError(
        "Pengecekan akun timeout. Coba lagi beberapa saat.",
        503,
        true,
      );
    }

    console.error("Codashop account checker failed", error);
    throw new AccountCheckError(
      "Tidak bisa terhubung ke layanan pengecekan akun.",
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
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
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const serverId = typeof payload.serverId === "string" ? payload.serverId.trim() : "";

  if (!gameId || !userId || !serverId) {
    return Response.json(
      { error: "Game, User ID, dan Server / Zone ID wajib diisi." },
      { status: 400 },
    );
  }

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(gameId)) {
    return Response.json({ error: "Game ID tidak valid." }, { status: 400 });
  }

  if (!/^\d{4,20}$/.test(userId) || !/^\d{1,10}$/.test(serverId)) {
    return Response.json(
      { error: "Format User ID atau Server / Zone ID tidak valid." },
      { status: 400 },
    );
  }

  const [game] = await supabaseSelect<GameRow>("games", {
    select: "id,name,short_name,requires_server,active",
    filters: { id: `eq.${gameId}`, active: "eq.true" },
    limit: 1,
  });

  if (!game) {
    return Response.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  const gameText = normalize(`${game.name} ${game.short_name}`);
  if (!game.requires_server || !gameText.includes("mobile legends")) {
    return Response.json(
      { error: "Auto check saat ini baru tersedia untuk Mobile Legends." },
      { status: 422 },
    );
  }

  const cacheKey = `${game.id}:${userId}:${serverId}`;
  const cached = accountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({
      nickname: cached.nickname,
      server: cached.server,
      cached: true,
      source: "codashop",
    });
  }
  if (cached) accountCache.delete(cacheKey);

  if (rateLimitExceeded(getClientKey(request))) {
    return Response.json(
      { error: "Terlalu banyak pengecekan akun. Coba lagi beberapa menit." },
      { status: 429 },
    );
  }

  try {
    const result = await checkMobileLegendsWithCodashop(userId, serverId);

    accountCache.set(cacheKey, {
      nickname: result.nickname,
      server: serverId,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return Response.json({
      nickname: result.nickname,
      server: serverId,
      cached: false,
      source: "codashop",
    });
  } catch (error) {
    if (error instanceof AccountCheckError) {
      return Response.json(
        {
          error: error.message,
          retryable: error.retryable,
          source: "codashop",
        },
        { status: error.status },
      );
    }

    console.error("Account checker failed", error);
    return Response.json(
      { error: "Pengecekan akun gagal diproses." },
      { status: 502 },
    );
  }
}
