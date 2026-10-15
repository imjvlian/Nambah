import {
  NambahAuthError,
  appendClearNambahOAuthCookies,
  appendNambahAuthSessionCookies,
  exchangeGoogleCode,
  readNambahOAuthState,
} from "@/lib/nambah-auth";
import { safeNext } from "@/lib/next-path";
import { isPlausibleVerifier } from "@/lib/pkce";

export const runtime = "nodejs";

/**
 * Completes the Google sign-in flow.
 *
 * This path must stay under /api/auth/google. The PKCE verifier cookie is
 * scoped to that prefix, so a callback anywhere else would arrive without it
 * and every sign-in would fail with no obvious cause.
 *
 * Everything here answers with a redirect. The browser arrives at this URL as
 * a top-level navigation, so returning JSON would render a bare error object
 * as a full page with no way forward. Redirecting back to /login with a reason
 * keeps the person inside the flow and gives the form something to say.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const url = new URL(request.url);
  const backToLogin = new URL("/login", origin);

  const failure = (reason: string) => {
    backToLogin.searchParams.set("error", reason);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
    });
    appendClearNambahOAuthCookies(headers);
    headers.set("Location", backToLogin.toString());
    return new Response(null, { status: 302, headers });
  };

  // The browser lands here directly when the person cancels on Google's
  // consent screen, and Supabase reports that as an error parameter.
  if (url.searchParams.has("error")) {
    return failure("google");
  }

  const code = url.searchParams.get("code")?.trim() ?? "";
  if (!code) return failure("google");

  const { verifier, next } = readNambahOAuthState(request);

  // Without the verifier the authorization code cannot be redeemed. That is
  // the whole point of PKCE, so this is treated as a failed sign-in rather
  // than retried.
  if (!verifier || !isPlausibleVerifier(verifier)) {
    return failure("google");
  }

  try {
    const session = await exchangeGoogleCode({ code, codeVerifier: verifier });

    const headers = new Headers({
      "Cache-Control": "private, no-store",
    });
    appendClearNambahOAuthCookies(headers);
    appendNambahAuthSessionCookies(headers, session);

    // Re-validated on the way out as well. The cookie was checked when it was
    // written, but this is the value that actually becomes a Location header,
    // and a redirect is the one place where a mistake sends a session off-site.
    headers.set("Location", safeNext(next));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (error instanceof NambahAuthError) {
      console.error("Nambah Google callback failed", error.code, error.message);
    } else {
      console.error("Nambah Google callback failed", error);
    }
    return failure("google");
  }
}