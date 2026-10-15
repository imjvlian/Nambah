/**
 * Validates the `next` parameter used after a successful sign-in.
 *
 * This is a security check, not a convenience one. The value arrives from the
 * query string and is used to build a redirect, so anything that could leave
 * this origin would turn the sign-in flow into an open redirect: an attacker
 * sends a link like /login?next=https://evil.example and harvests the session
 * on a page they control.
 *
 * Rejecting protocol-relative URLs ("//evil.example") matters as much as
 * rejecting absolute ones, because `new URL("//evil.example", origin)` resolves
 * to a different host even though the string starts with a slash.
 */
export const DEFAULT_NEXT_PATH = "/account";

export function safeNext(value?: string | null): string {
  if (!value) return DEFAULT_NEXT_PATH;
  if (!value.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (value.startsWith("//")) return DEFAULT_NEXT_PATH;
  // Defensive: a backslash is treated as a path separator by some browsers,
  // which can turn "/\evil.example" back into a protocol-relative URL.
  if (value.includes("\\")) return DEFAULT_NEXT_PATH;
  if (value.includes("\n") || value.includes("\r")) return DEFAULT_NEXT_PATH;
  return value;
}

/**
 * The same check for server components that pass the value down to a client
 * form, where an absent value is easier to represent than a default.
 */
export function optionalSafeNext(value?: string | null): string | undefined {
  const resolved = safeNext(value);
  return resolved === DEFAULT_NEXT_PATH ? undefined : resolved;
}

/** Builds a sign-in link that returns the user to where they came from. */
export function signInHref(path: "/login" | "/register", next?: string | null) {
  const resolved = safeNext(next);
  if (resolved === DEFAULT_NEXT_PATH) return path;
  return `${path}?next=${encodeURIComponent(resolved)}`;
}