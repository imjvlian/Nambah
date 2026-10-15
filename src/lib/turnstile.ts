/**
 * Verifikasi token Cloudflare Turnstile secara server-side.
 *
 * Token Turnstile bersifat sekali pakai dan hanya boleh diverifikasi di server.
 * Jangan pernah memperlakukan token yang lolos client-side sebagai bukti aman.
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const ALLOWED_HOSTNAMES = new Set(
  (process.env.TURNSTILE_ALLOWED_HOSTNAMES || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);

export type TurnstileVerifyResult = {
  success: boolean;
  hostname?: string;
  errorCode?: string;
};

function getSecretKey() {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === "production";
}

function allowedHostnames() {
  const defaults = ["localhost", "127.0.0.1", "nambah.my.id", "www.nambah.my.id"];
  const fromEnv = Array.from(ALLOWED_HOSTNAMES);
  return new Set([...defaults, ...fromEnv].map((item) => item.toLowerCase()));
}

export function isTurnstileEnabled() {
  return Boolean(getSecretKey());
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const direct = request.headers.get("x-real-ip")?.trim();
  if (direct) return direct;

  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;

  return "";
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp = "",
  expectedAction?: string,
): Promise<TurnstileVerifyResult> {
  const secret = getSecretKey();

  // Turnstile token is a single-use string, not an identifier. Keep a minimal
  // non-empty check before hitting Cloudflare. Reject blank whitespace-only
  // values even if the `trim()` copy happened elsewhere.
  const cleaned = token.trim();
  if (!cleaned) {
    return { success: false, errorCode: "missing-token" };
  }

  // Development guard, not a bypass. Production with no configured secret is a
  // fail-closed state. Tests can still exercise the disabled path if needed.
  if (!secret) {
    if (isProductionEnvironment()) {
      return { success: false, errorCode: "secret-not-configured" };
    }
    return { success: true, hostname: "localhost" };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", cleaned);
  if (remoteIp) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch {
    // Do not retry aggressively here. The caller already has the rate limiter
    // and can surface a control-failure message to the user.
    return { success: false, errorCode: "network-error" };
  }

  if (!response.ok) {
    return {
      success: false,
      errorCode: `http-${response.status}`,
    };
  }

  const data = (await response.json()) as {
    success?: unknown;
    hostname?: unknown;
    "error-codes"?: unknown;
    action?: unknown;
  };

  if (data.success !== true) {
    const errors = Array.isArray(data["error-codes"])
      ? data["error-codes"].join(",")
      : undefined;
    return { success: false, errorCode: errors || "verification-failed" };
  }

  if (expectedAction && typeof data.action === "string" && data.action !== expectedAction) {
    return { success: false, errorCode: "action-mismatch" };
  }

  const hostname = typeof data.hostname === "string" ? data.hostname.toLowerCase() : undefined;
  if (hostname && !allowedHostnames().has(hostname)) {
    return { success: false, errorCode: "hostname-mismatch" };
  }

  return {
    success: true,
    hostname,
  };
}
