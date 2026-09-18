import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "nambah_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 2 * 60 * 60;

export type AdminPrincipal = {
  mode: "account" | "legacy";
  userId: string | null;
  role: "admin" | "superadmin" | "legacy";
  exp: number;
};

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function configuredAdminToken() {
  return process.env.NAMBAH_ADMIN_API_TOKEN?.trim() ?? "";
}

function configuredAdminSessionSecret() {
  return process.env.NAMBAH_ADMIN_SESSION_SECRET?.trim() || configuredAdminToken();
}

function signAdminSession(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const item of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return "";
}

export function isAdminApiConfigured() {
  return Boolean(configuredAdminSessionSecret());
}

export function verifyAdminToken(suppliedToken: string) {
  const configuredToken = configuredAdminToken();
  return Boolean(
    configuredToken && suppliedToken && safeEqual(suppliedToken.trim(), configuredToken),
  );
}

export function createAdminSessionValue(
  input?: {
    userId?: string | null;
    role?: "admin" | "superadmin";
    mode?: "account" | "legacy";
  },
  now = Date.now(),
) {
  const secret = configuredAdminSessionSecret();
  if (!secret) throw new Error("Admin session secret belum dikonfigurasi.");

  const mode = input?.mode ?? "legacy";
  const role = mode === "legacy" ? "legacy" : input?.role ?? "admin";
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS,
      mode,
      userId: mode === "account" ? input?.userId ?? null : null,
      role,
    }),
  ).toString("base64url");

  return `${payload}.${signAdminSession(payload, secret)}`;
}

export function verifyAdminSessionValue(value: string): AdminPrincipal | null {
  const secret = configuredAdminSessionSecret();
  if (!secret || !value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signAdminSession(payload, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    ) as Partial<AdminPrincipal>;

    if (
      typeof parsed.exp !== "number" ||
      parsed.exp <= Math.floor(Date.now() / 1000) ||
      (parsed.mode !== "account" && parsed.mode !== "legacy") ||
      (parsed.role !== "admin" &&
        parsed.role !== "superadmin" &&
        parsed.role !== "legacy")
    ) {
      return null;
    }

    if (parsed.mode === "account" && !parsed.userId) return null;

    return {
      exp: parsed.exp,
      mode: parsed.mode,
      userId: parsed.mode === "account" ? parsed.userId ?? null : null,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

export function createAdminSessionCookie(value: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${secure}`;
}

export function clearAdminSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function getAdminRequestPrincipal(request: Request): AdminPrincipal | null {
  const configuredToken = configuredAdminToken();
  const header = request.headers.get("authorization") ?? "";
  const suppliedToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (configuredToken && suppliedToken && safeEqual(suppliedToken, configuredToken)) {
    return {
      mode: "legacy",
      userId: null,
      role: "legacy",
      exp: Math.floor(Date.now() / 1000) + 60,
    };
  }

  return verifyAdminSessionValue(readCookie(request, ADMIN_SESSION_COOKIE));
}

export function isAdminRequestAuthorized(request: Request) {
  return Boolean(getAdminRequestPrincipal(request));
}

export function authorizeAdminRequest(
  request: Request,
  options?: { superadminOnly?: boolean },
) {
  if (!isAdminApiConfigured()) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Admin session secret belum dikonfigurasi." },
        { status: 503 },
      ),
    };
  }

  const principal = getAdminRequestPrincipal(request);
  if (!principal) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  if (
    options?.superadminOnly &&
    principal.role !== "superadmin" &&
    principal.role !== "legacy"
  ) {
    return {
      ok: false as const,
      response: Response.json({ error: "Superadmin access required." }, { status: 403 }),
    };
  }

  return { ok: true as const, principal };
}
