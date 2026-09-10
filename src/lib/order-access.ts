import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseSelect } from "@/lib/supabase/server";

const ORDER_ACCESS_COOKIE = "nambah_order_access";
const ORDER_ACCESS_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type OrderAccessRow = {
  access_token_hash: string | null;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqualHash(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createOrderAccessCredential() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
  };
}

export function createOrderAccessCookie(orderId: string, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const path = `/api/orders/${encodeURIComponent(orderId)}`;
  return `${ORDER_ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${ORDER_ACCESS_MAX_AGE_SECONDS}${secure}`;
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const item of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return rawValue.join("=");
    }
  }
  return "";
}

export function readOrderAccessToken(request: Request) {
  const url = new URL(request.url);
  return (
    request.headers.get("x-order-access-token")?.trim() ||
    url.searchParams.get("access_token")?.trim() ||
    readCookie(request, ORDER_ACCESS_COOKIE).trim() ||
    ""
  );
}

export async function verifyOrderAccess(orderId: string, token: string) {
  if (!orderId || !token) return false;

  const [order] = await supabaseSelect<OrderAccessRow>("orders", {
    select: "access_token_hash",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  if (!order?.access_token_hash) return false;
  return safeEqualHash(order.access_token_hash, hashToken(token.trim()));
}
