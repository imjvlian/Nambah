import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "nambah_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function configuredAdminToken() {
  return process.env.NAMBAH_ADMIN_API_TOKEN?.trim() ?? "";
}

function signAdminSession(payload: string, token: string) {
  return createHmac("sha256", token).update(payload).digest("base64url");
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
  return Boolean(configuredAdminToken());
}

export function verifyAdminToken(suppliedToken: string) {
  const configuredToken = configuredAdminToken();
  return Boolean(
    configuredToken && suppliedToken && safeEqual(suppliedToken.trim(), configuredToken),
  );
}

export function createAdminSessionValue(now = Date.now()) {
  const token = configuredAdminToken();
  if (!token) throw new Error("Admin API token belum dikonfigurasi.");

  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS,
    }),
  ).toString("base64url");

  return `${payload}.${signAdminSession(payload, token)}`;
}

export function verifyAdminSessionValue(value: string) {
  const token = configuredAdminToken();
  if (!token || !value) return false;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = signAdminSession(payload, token);
  if (!safeEqual(signature, expectedSignature)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
      exp?: number;
    };
    return typeof parsed.exp === "number" && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
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

export function isAdminRequestAuthorized(request: Request) {
  const configuredToken = configuredAdminToken();
  if (!configuredToken) return false;

  const header = request.headers.get("authorization") ?? "";
  const suppliedToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (suppliedToken && safeEqual(suppliedToken, configuredToken)) return true;

  const session = readCookie(request, ADMIN_SESSION_COOKIE);
  return verifyAdminSessionValue(session);
}

export function authorizeAdminRequest(request: Request) {
  if (!isAdminApiConfigured()) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Admin API token belum dikonfigurasi." },
        { status: 503 },
      ),
    };
  }

  if (!isAdminRequestAuthorized(request)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  return { ok: true as const };
}
