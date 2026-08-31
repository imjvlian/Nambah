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

type CachedUsername = {
  nickname: string;
  expiresAt: number;
};

type PendingCheck = {
  refId: string;
  supplierSku: string;
  startedAt: number;
};

const USERNAME_CACHE_TTL_MS = 15 * 60 * 1000;
const PENDING_RECHECK_AFTER_MS = 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 6;
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

function isUsernameCheckerEnabled() {
  const value = process.env.DIGIFLAZZ_USERNAME_CHECK_ENABLED?.trim().toLowerCase();
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
  // Digiflazz documents Mobile Legends customer_no as gabungan user_id + zone_id.
  return `${userId}${serverId}`;
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

export async function POST(request: Request) {
  if (!isUsernameCheckerEnabled()) {
    return Response.json(
      {
        error:
          "Username checker belum diaktifkan. Set DIGIFLAZZ_USERNAME_CHECK_ENABLED=true setelah memahami bahwa pengecekan memakai transaksi checker Digiflazz.",
      },
      { status: 503 },
    );
  }

  if (!isSupabaseConfigured() || !isDigiflazzConfigured()) {
    return Response.json(
      { error: "Konfigurasi database atau Digiflazz belum lengkap." },
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
      source: "digiflazz",
    });
  }
  if (cached) usernameCache.delete(cacheKey);

  const pending = pendingChecks.get(cacheKey);
  if (pending && Date.now() - pending.startedAt < PENDING_RECHECK_AFTER_MS) {
    return Response.json(
      {
        pending: true,
        message: "Checker supplier masih memproses data akun. Coba lagi setelah sekitar 1 menit.",
      },
      { status: 202 },
    );
  }

  const clientKey = getClientKey(request);
  if (rateLimitExceeded(clientKey)) {
    return Response.json(
      { error: "Terlalu banyak pengecekan username. Coba lagi beberapa menit." },
      { status: 429 },
    );
  }

  const checker = await findMobileLegendsChecker();
  if (!checker) {
    return Response.json(
      {
        error:
          "SKU Mobile Legends Cek Username belum ada di cache katalog. Tambahkan produk checker di Digiflazz Buyer lalu lakukan Scan sekali dari admin Nambah.",
      },
      { status: 409 },
    );
  }

  if (!checker.buyer_active || !checker.seller_active) {
    return Response.json(
      { error: "Produk checker Mobile Legends sedang tidak aktif di supplier." },
      { status: 409 },
    );
  }

  const checkerCost = Number(checker.supplier_cost);
  if (!Number.isFinite(checkerCost) || checkerCost < 0 || checkerCost > MAX_CHECKER_COST) {
    return Response.json(
      { error: "Harga produk checker supplier berada di luar batas aman Nambah." },
      { status: 409 },
    );
  }

  const refId =
    pending?.refId ?? `nambah-check-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;

  try {
    const transaction = await runDigiflazzPrepaidTransaction({
      buyerSkuCode: checker.supplier_sku,
      customerNo: target,
      refId,
      maxPrice: MAX_CHECKER_COST,
      useCallback: false,
    });

    const status = normalize(transaction.status || transaction.message || "");
    const success = transaction.rc === "00" || status.includes("sukses") || status.includes("success");
    const isPending = status.includes("pending") || status.includes("process") || transaction.rc === "03";

    if (isPending && !success) {
      pendingChecks.set(cacheKey, {
        refId,
        supplierSku: checker.supplier_sku,
        startedAt: pending?.startedAt ?? Date.now(),
      });
      return Response.json(
        {
          pending: true,
          message: "Checker supplier masih memproses data akun. Coba lagi setelah sekitar 1 menit.",
        },
        { status: 202 },
      );
    }

    pendingChecks.delete(cacheKey);

    if (!success) {
      return Response.json(
        {
          error:
            transaction.message?.trim() ||
            "Username tidak dapat diverifikasi oleh supplier. Periksa kembali ID akun.",
        },
        { status: 422 },
      );
    }

    const nickname = extractNickname(transaction.sn);
    if (!nickname) {
      return Response.json({
        verified: true,
        message: "Akun ditemukan, tetapi supplier tidak mengembalikan nickname.",
        source: "digiflazz",
      });
    }

    usernameCache.set(cacheKey, {
      nickname,
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
            ? "Checker Digiflazz sedang sibuk. Coba lagi beberapa saat."
            : error.message,
        },
        { status: error.retryable ? 503 : 502 },
      );
    }

    console.error("Username checker failed", error);
    return Response.json(
      { error: "Username checker gagal diproses." },
      { status: 502 },
    );
  }
}
