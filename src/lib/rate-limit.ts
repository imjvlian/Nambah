import { createHash, createHmac } from "node:crypto";
import { supabaseRpc } from "@/lib/supabase/server";

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowSeconds: number;
  /**
   * Optional extra key material, such as the email address being verified.
   *
   * A six digit verification code has a small enough key space that an IP-only
   * limit is not sufficient: an attacker who rotates IP addresses would
   * otherwise be free to keep guessing. Adding the address means the counter
   * follows the account rather than the connection. Callers that pass a
   * subject should still apply an IP limit as well, so that a single attacker
   * cannot grind through many different addresses.
   */
  subject?: string;
};

type RateLimitRpcResult = {
  allowed?: boolean;
  count?: number;
  limit?: number;
  remaining?: number;
  resetAt?: string;
};

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: string | null;
  degraded: boolean;
};

function clientIdentity(request: Request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";
  const ip = forwarded.split(",")[0]?.trim() || "local";
  const ua = request.headers.get("user-agent")?.slice(0, 160) || "unknown";
  return ip + "|" + ua;
}

function normalizeSubject(subject?: string) {
  const trimmed = (subject ?? "").trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 254) : "";
}

/**
 * Exported for tests. The key is an HMAC, so the tests can only compare keys
 * against each other, never recover the email from one.
 */
export function anonymizedKey(
  request: Request,
  scope: string,
  subject?: string,
) {
  const normalizedSubject = normalizeSubject(subject);
  const raw =
    scope +
    "|" +
    clientIdentity(request) +
    (normalizedSubject ? "|" + normalizedSubject : "");
  const secret = process.env.NAMBAH_RATE_LIMIT_SECRET?.trim() ?? "";

  return secret
    ? createHmac("sha256", secret).update(raw).digest("hex")
    : createHash("sha256").update(raw).digest("hex");
}

export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowSeconds = Math.max(1, Math.floor(options.windowSeconds));

  try {
    const result = await supabaseRpc<RateLimitRpcResult>(
      "nambah_rate_limit_hit",
      {
        p_key: anonymizedKey(request, options.scope, options.subject),
        p_limit: limit,
        p_window_seconds: windowSeconds,
      },
    );

    return {
      allowed: result.allowed !== false,
      count: Number(result.count ?? 0),
      limit: Number(result.limit ?? limit),
      remaining: Math.max(0, Number(result.remaining ?? limit)),
      resetAt:
        typeof result.resetAt === "string" ? result.resetAt : null,
      degraded: false,
    };
  } catch (error) {
    console.error("Durable rate limit unavailable", options.scope, error);
    return {
      allowed: true,
      count: 0,
      limit,
      remaining: limit,
      resetAt: null,
      degraded: true,
    };
  }
}

export async function rateLimitResponse(
  request: Request,
  options: RateLimitOptions,
) {
  const result = await checkRateLimit(request, options);
  if (result.allowed) return null;

  const retryAfter = result.resetAt
    ? Math.max(
        1,
        Math.ceil(
          (new Date(result.resetAt).getTime() - Date.now()) / 1000,
        ),
      )
    : options.windowSeconds;

  return Response.json(
    {
      error: "Terlalu banyak request. Coba lagi beberapa saat.",
      retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}
