/**
 * Resolves the public origin of this site.
 *
 * Why this exists: redirect URLs sent to Supabase Auth (the Google callback,
 * the password reset link) have to match an entry in Supabase's allow list
 * exactly. When they do not, Supabase does not report an error. It silently
 * falls back to the Site URL, the person comes back to the homepage instead of
 * the callback, and the feature looks broken with nothing in any log.
 *
 * `new URL(request.url).origin` is not a safe source for that, because behind
 * a reverse proxy Next.js can report the internal address it was reached on
 * rather than the public one, depending entirely on which forwarded headers the
 * proxy sets. On a laptop that is never wrong, which means local testing
 * cannot surface the problem at all.
 *
 * The order below is deliberate:
 *   1. SITE_URL, when configured. Deterministic and immune to both the proxy
 *      and to the server being reachable on more than one host.
 *   2. Forwarded headers, which is what a correctly configured proxy sends.
 *   3. The raw request origin, as a last resort.
 *
 * Trusting forwarded headers when SITE_URL is unset carries a host-header
 * injection risk in principle. The damage is bounded: the value only ever
 * becomes Supabase's redirect_to, which Supabase validates against its own
 * allow list, so a forged host is rejected rather than honoured. Setting
 * SITE_URL removes the ambiguity entirely.
 */
export function resolveSiteOrigin(request: Request): string {
  const configured = normalizeOrigin(process.env.SITE_URL);
  if (configured) return configured;

  const forwarded = forwardedOrigin(request);
  if (forwarded) return forwarded;

  return normalizeOrigin(new URL(request.url).origin) ?? "http://localhost";
}

/** Builds an absolute URL on the public site, with exactly one leading slash. */
export function resolveSiteUrl(request: Request, path: string): string {
  const origin = resolveSiteOrigin(request);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${suffix}`;
}

function forwardedOrigin(request: Request): string | null {
  const proto = firstValue(request.headers.get("x-forwarded-proto"));
  const host = firstValue(request.headers.get("x-forwarded-host"));

  if (!proto || !host) return null;

  return normalizeOrigin(`${proto}://${host}`);
}

function firstValue(header: string | null) {
  if (!header) return "";
  return header.split(",")[0]?.trim() ?? "";
}

function normalizeOrigin(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // A bare "nambah.my.id" is a common way to write this by mistake. Guessing
  // the protocol here would hide the mistake until redirect_to is rejected, so
  // an unparseable value is dropped and the next source is used instead.
  let parsed: URL;
  try {
    // Only http(s) and scheme-less values are acceptable. Other schemes
    // (ftp, javascript, etc.) are rejected in full, not upgraded to https.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      parsed = new URL(trimmed);
    } else {
      parsed = new URL(`https://${trimmed}`);
    }
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (!parsed.hostname) return null;

  return `${parsed.protocol}//${parsed.host}`;
}