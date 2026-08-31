import { randomUUID } from "node:crypto";
import {
  DigiflazzApiError,
  isDigiflazzConfigured,
  runDigiflazzPrepaidTransaction,
} from "@/lib/digiflazz/client";
import {
  isSupabaseConfigured,
  supabaseSelect,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type GameRow = {
  id: string;
  name: string;
  short_name: string;
  requires_server: boolean;
  active: boolean;
};

type CheckerRow = {
  supplier_sku: string;
  product_name: string;
  brand: string;
  type: string;
  supplier_cost: number | string;
  buyer_active: boolean;
  seller_active: boolean;
  last_seen_at: string;
};

type UsernameSource = "evo" | "digiflazz";

type CachedUsername = {
  nickname: string;
  source: UsernameSource;
  expiresAt: number;
};

type PendingCheck = {
  refId: string;
  supplierSku: string;
  startedAt: number;
};

type EvoGameCheckResponse = {
  status?: string;
  data?: {
    username?: string;
    region?: string | null;
  };
  message?: string;
  response_time_ms?: number;
};

type EvoFailureKind =
  | "not_found"
  | "rate_limit"
  | "temporary"
  | "configuration"
  | "validation"
  | "unknown";

class EvoGameCheckError extends Error {
  readonly kind: EvoFailureKind;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { kind: EvoFailureKind; status: number; retryable?: boolean },
  ) {
    super(message);
    this.name = "EvoGameCheckError";
    this.kind = options.kind;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

const EVO_CHECK_URL = "https://gamecheck.evogamestore.com/api/v1/check";
const USERNAME_CACHE_TTL_MS = 10 * 60 * 1000;
const PENDING_RECHECK_AFTER_MS = 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const MAX_CHECKER_COST = 1_000;

const usernameCache = new Map<string, CachedUsername>();
const pendingChecks = new Map<string, PendingCheck>();
const rateLimits = new Map<string, number[]>();

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getEvoApiKey() {
  return process.env.EVO_GAME_CHECK_API_KEY?.trim() ?? "";
}

function isDigiflazzFallbackEnabled() {
  const value = process.env.DIGIFLAZZ_USERNAME_CHECK_FALLBACK_ENABLED
    ?.trim()
    .toLowerCase();
  return value === "true" || value === "1" || value === "yes";
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
  const previous = (rateLimits.get(clientKey) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  if (previous.length >= RATE_LIMIT_MAX) {
    rateLimits.set(clientKey, previous);
    return true;
  }

  previous.push(now);
  rateLimits.set(clientKey, previous);
  return false;
}

function extractNickname(rawValue: string | undefined) {
  const raw = rawValue?.trim() ?? "";
  if (!raw) return null;

  const labeled = raw.match(
    /(?:username|nickname|nick|nama(?:\s+akun)?|ign)\s*[:=]\s*([^|;,]+)/i,
  );
  if (labeled?.[1]?.trim()) return labeled[1].trim();

  const candidates = raw
    .split(/[|;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(sukses|success|transaksi sukses|ok)$/i.test(part))
    .filter((part) => /[^\d\s]/u.test(part));

  return candidates[0] ?? raw;
}

function checkerTarget(userId: string, serverId: string) {
  return `${userId}${serverId}`;
}

async function checkMobileLegendsWithEvo(userId: string, serverId: string) {
  const apiKey = getEvoApiKey();
  if (!apiKey) {
    throw new EvoGameCheckError(
      "Evo Game Check belum dikonfigurasi di server Nambah.",
      { kind: "configuration", status: 503 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(EVO_CHECK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        game: "mobile-legends",
        user_id: userId,
        zone: serverId,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: EvoGameCheckResponse | null = null;

    try {
      payload = raw ? (JSON.parse(raw) as EvoGameCheckResponse) : null;
    } catch {
      throw new EvoGameCheckError(
        "Evo Game Check mengembalikan response yang tidak valid.",
        {
          kind: "temporary",
          status: 503,
          retryable: true,
        },
      );
    }

    const status = normalize(payload?.status ?? "");
    const nickname = payload?.data?.username?.trim() ?? "";

    if (response.ok && (status === "success" || nickname)) {
      if (!nickname) {
        throw new EvoGameCheckError(
          "Akun ditemukan, tetapi nickname tidak tersedia dari checker.",
          { kind: "unknown", status: 502, retryable: true },
        );
      }

      return {
        nickname,
        region: payload?.data?.region ?? null,
        providerCached:
          response.headers.get("x-cache")?.trim().toUpperCase() === "HIT",
      };
    }

    const message = payload?.message?.trim() || "Username tidak dapat diperiksa.";

    if (response.status === 404 || status === "not found") {
      throw new EvoGameCheckError(
        message || "User ID / Zone tidak ditemukan.",
        { kind: "not_found", status: 404 },
      );
    }

    if (response.status === 422) {
      throw new EvoGameCheckError(message, {
        kind: "validation",
        status: 422,
      });
    }

    if (response.status === 429) {
      throw new EvoGameCheckError(
        "Username checker gratis sedang mencapai batas request. Coba lagi sebentar.",
        {
          kind: "rate_limit",
          status: 429,
          retryable: true,
        },
      );
    }

    if (
      response.status === 503 ||
      status === "temporary failure" ||
      response.status >= 500
    ) {
      throw new EvoGameCheckError(
        "Username checker gratis sedang mengalami gangguan sementara.",
        {
          kind: "temporary",
          status: 503,
          retryable: true,
        },
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new EvoGameCheckError(
        "API key Evo Game Check tidak valid atau sudah tidak aktif.",
        {
          kind: "configuration",
          status: 503,
        },
      );
    }

    throw new EvoGameCheckError(message, {
      kind: "unknown",
      status: response.status >= 400 ? response.status : 502,
      retryable: response.status >= 500,
    });
  } catch (error) {
    if (error instanceof EvoGameCheckError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new EvoGameCheckError(
        "Username checker gratis timeout. Coba lagi beberapa saat.",
        {
          kind: "temporary",
          status: 503,
          retryable: true,
        },
      );
    }

    throw new EvoGameCheckError(
      "Tidak bisa terhubung ke username checker gratis.",
      {
        kind: "temporary",
        status: 503,
        retryable: true,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function findMobileLegendsChecker() {
  const rows = await supabaseSelect<CheckerRow>("supplier_catalog_items", {
    select:
      "supplier_sku,product_name,brand,type,supplier_cost,buyer_active,seller_active,last_seen_at",
    filters: {
      supplier_id: "eq.digiflazz",
      product_name: "ilike.*cek*username*",
    },
    order: "last_seen_at.desc",
    limit: 100,
  });

  return rows.find((row) => {
    const text = normalize(`${row.brand} ${row.product_name}`);
    return text.includes("mobile legends");
  });
}

async function checkMobileLegendsWithDigiflazz(input: {
  cacheKey: string;
  target: string;
}) {
  if (!isDigiflazzConfigured()) {
    return Response.json(
      { error: "Fallback Digiflazz belum dikonfigurasi." },
      { status: 503 },
    );
  }

  const pending = pendingChecks.get(input.cacheKey);
  if (pending && Date.now() - pending.startedAt < PENDING_RECHECK_AFTER_MS) {
    return Response.json(
      {
        pending: true,
        source: "digiflazz",
        message: "Fallback supplier masih memproses data akun. Coba lagi setelah sekitar 1 menit.",
      },
      { status: 202 },
    );
  }

  const checker = await findMobileLegendsChecker();
  if (!checker) {
    return Response.json(
      {
        error:
          "Fallback Digiflazz tidak tersedia karena SKU Cek Username belum ada di cache katalog.",
      },
      { status: 409 },
    );
  }

  if (!checker.buyer_active || !checker.seller_active) {
    return Response.json(
      { error: "Produk fallback username checker sedang tidak aktif di supplier." },
      { status: 409 },
    );
  }

  const checkerCost = Number(checker.supplier_cost);
  if (!Number.isFinite(checkerCost) || checkerCost < 0 || checkerCost > MAX_CHECKER_COST) {
    return Response.json(
      { error: "Harga fallback checker supplier berada di luar batas aman Nambah." },
      { status: 409 },
    );
  }

  const refId =
    pending?.refId ??
    `nambah-check-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;

  try {
    const transaction = await runDigiflazzPrepaidTransaction({
      buyerSkuCode: checker.supplier_sku,
      customerNo: input.target,
      refId,
      maxPrice: MAX_CHECKER_COST,
      useCallback: false,
    });

    const status = normalize(transaction.status || transaction.message || "");
    const success =
      transaction.rc === "00" ||
      status.includes("sukses") ||
      status.includes("success");
    const isPending =
      status.includes("pending") ||
      status.includes("process") ||
      transaction.rc === "03";

    if (isPending && !success) {
      pendingChecks.set(input.cacheKey, {
        refId,
        supplierSku: checker.supplier_sku,
        startedAt: pending?.startedAt ?? Date.now(),
      });
      return Response.json(
        {
          pending: true,
          source: "digiflazz",
          message: "Fallback supplier masih memproses data akun. Coba lagi setelah sekitar 1 menit.",
        },
        { status: 202 },
      );
    }

    pendingChecks.delete(input.cacheKey);

    if (!success) {
      return Response.json(
        {
          error:
            transaction.message?.trim() ||
            "Username tidak dapat diverifikasi oleh fallback supplier.",
        },
        { status: 422 },
      );
    }

    const nickname = extractNickname(transaction.sn);
    if (!nickname) {
      return Response.json({
        verified: true,
        message: "Akun ditemukan, tetapi fallback supplier tidak mengembalikan nickname.",
        source: "digiflazz",
      });
    }

    usernameCache.set(input.cacheKey, {
      nickname,
      source: "digiflazz",
      expiresAt: Date.now() + USERNAME_CACHE_TTL_MS,
    });

    return Response.json({
      nickname,
      cached: false,
      source: "digiflazz",
    });
  } catch (error) {
    if (error instanceof DigiflazzApiError) {
      return Response.json(
        {
          error: error.retryable
            ? "Fallback Digiflazz sedang sibuk. Coba lagi beberapa saat."
            : error.message,
        },
        { status: error.retryable ? 503 : 502 },
      );
    }

    console.error("Digiflazz username checker fallback failed", error);
    return Response.json(
      { error: "Fallback username checker gagal diproses." },
      { status: 502 },
    );
  }
}

function evoErrorResponse(error: EvoGameCheckError) {
  const safeMessage =
    error.kind === "not_found"
      ? "User ID / Server tidak ditemukan. Periksa kembali data akun."
      : error.message;

  return Response.json(
    {
      error: safeMessage,
      source: "evo",
      retryable: error.retryable,
    },
    { status: error.status },
  );
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
      { error: "Username checker saat ini baru tersedia untuk Mobile Legends." },
      { status: 422 },
    );
  }

  const target = checkerTarget(userId, serverId);
  const cacheKey = `${game.id}:${target}`;
  const cached = usernameCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({
      nickname: cached.nickname,
      cached: true,
      source: cached.source,
    });
  }
  if (cached) usernameCache.delete(cacheKey);

  const clientKey = getClientKey(request);
  if (rateLimitExceeded(clientKey)) {
    return Response.json(
      { error: "Terlalu banyak pengecekan username. Coba lagi beberapa menit." },
      { status: 429 },
    );
  }

  try {
    const evoResult = await checkMobileLegendsWithEvo(userId, serverId);

    usernameCache.set(cacheKey, {
      nickname: evoResult.nickname,
      source: "evo",
      expiresAt: Date.now() + USERNAME_CACHE_TTL_MS,
    });

    return Response.json({
      nickname: evoResult.nickname,
      region: evoResult.region,
      cached: false,
      providerCached: evoResult.providerCached,
      source: "evo",
    });
  } catch (error) {
    if (!(error instanceof EvoGameCheckError)) {
      console.error("Evo username checker failed", error);
      return Response.json(
        { error: "Username checker gratis gagal diproses." },
        { status: 502 },
      );
    }

    const canUsePaidFallback =
      isDigiflazzFallbackEnabled() &&
      error.kind !== "not_found" &&
      error.kind !== "validation";

    if (!canUsePaidFallback) {
      return evoErrorResponse(error);
    }

    return checkMobileLegendsWithDigiflazz({ cacheKey, target });
  }
}
