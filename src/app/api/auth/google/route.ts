import {
  NambahAuthError,
  appendNambahOAuthCookies,
  buildGoogleAuthorizeUrl,
} from "@/lib/nambah-auth";
import { safeNext } from "@/lib/next-path";
import { createPkcePair } from "@/lib/pkce";
import { rateLimitResponse } from "@/lib/rate-limit";
import { resolveSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

const CALLBACK_PATH = "/api/auth/google/callback";

/**
 * Starts the Google sign-in flow.
 *
 * This is a plain link target rather than a fetch, so sign-in with Google
 * still works with JavaScript unavailable or disabled, and so the button can
 * be reached by keyboard and by screen readers as an ordinary link.
 */
export async function GET(request: Request) {
  const origin = resolveSiteUrl(request, "/login");
  const originError = `${origin}?error=google`;
  const callbackUrl = resolveSiteUrl(request, CALLBACK_PATH);

  const limited = await rateLimitResponse(request, {
    scope: "auth-google-start",
    limit: 20,
    windowSeconds: 10 * 60,
  });
  if (limited) return limited;

  let verifier: string;
  let challenge: string;

  try {
    const pair = createPkcePair();
    verifier = pair.verifier;
    challenge = pair.challenge;
  } catch (error) {
    console.error("Nambah Google auth start failed", error);
    return Response.redirect(originError, 302);
  }

  let authorizeUrl: string;
  try {
    authorizeUrl = buildGoogleAuthorizeUrl({
      redirectTo: callbackUrl,
      codeChallenge: challenge,
    });
  } catch (error) {
    if (error instanceof NambahAuthError) console.error(error.message);
    return Response.redirect(originError, 302);
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store",
  });

  appendNambahOAuthCookies(headers, {
    verifier,
    // Validated here rather than at the callback. The callback trusts this
    // cookie as if it had already been checked, so the check has to happen
    // while the request is still one the server can reason about.
    next: safeNext(new URL(request.url).searchParams.get("next")),
  });

  headers.set("Location", authorizeUrl);

  return new Response(null, { status: 302, headers });
}