import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET_ENV = "NAMBAH_ORDER_ACCESS_TOKEN_SECRET";

/**
 * Returns the server-only secret used to sign order access tokens.
 * Throws at startup if the secret is not configured, so a missing
 * configuration is loud instead of silently allowing unauthenticated access.
 */
export function getOrderAccessSecret(): string {
  const secret = process.env[SECRET_ENV]?.trim();
  if (!secret) {
    throw new Error(`Order access token secret is not configured: ${SECRET_ENV}`);
  }
  return secret;
}

/**
 * Signs an order ID into a base64url HMAC-SHA256 token.
 * The token is deterministic and stateless — no database lookup required.
 */
export function signOrderAccess(orderId: string): string {
  return createHmac("sha256", getOrderAccessSecret())
    .update(orderId)
    .digest("base64url");
}

/**
 * Verifies an order access token against the expected HMAC.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyOrderAccess(orderId: string, token: string): boolean {
  if (!token) return false;
  try {
    const expected = signOrderAccess(orderId);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token.trim()));
  } catch {
    return false;
  }
}