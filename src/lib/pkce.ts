import { createHash, randomBytes } from "node:crypto";

/**
 * PKCE (RFC 7636) helpers for the server-side OAuth flow.
 *
 * The point of PKCE is that an intercepted authorization code is useless on
 * its own: redeeming it requires the verifier, and that verifier never leaves
 * this server. Supabase still requires the exchange to prove it started here,
 * so the flow cannot be driven from a leaked or replayed callback URL.
 */

/** Bytes of entropy behind the verifier. 32 gives a 43 character value. */
const VERIFIER_BYTES = 32;

/**
 * The verifier is the high-entropy secret kept in an httpOnly cookie between
 * the authorize redirect and the callback.
 */
export function createCodeVerifier() {
  return base64Url(randomBytes(VERIFIER_BYTES));
}

/**
 * The challenge derived from the verifier. It is safe to send through Google
 * and through the redirect chain because it cannot be used to obtain a token.
 */
export function createCodeChallenge(verifier: string) {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}

/** Creates a verifier and its matching challenge in one step. */
export function createPkcePair() {
  const verifier = createCodeVerifier();
  return { verifier, challenge: createCodeChallenge(verifier) };
}

function base64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Verifier shape check for values read back from the cookie. Anything that is
 * not base64url of a sane length is rejected before it reaches Supabase rather
 * than being sent as a malformed parameter.
 */
export function isPlausibleVerifier(value: string) {
  return /^[A-Za-z0-9\-_]{43,128}$/.test(value);
}