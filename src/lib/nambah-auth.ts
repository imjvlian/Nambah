import { BRAND } from "@/lib/brand";

const ACCESS_COOKIE = "nambah_auth_access";
const REFRESH_COOKIE = "nambah_auth_refresh";
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type NambahAuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  created_at?: string;
  user_metadata?: Record<string, unknown>;
};

export type NambahAuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  user?: NambahAuthUser | null;
};

type AuthPayload = Partial<NambahAuthSession> & {
  user?: NambahAuthUser | null;
  session?: NambahAuthSession | null;
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
  code?: string;
};

export type NambahAuthContext = {
  user: NambahAuthUser | null;
  refreshedSession: NambahAuthSession | null;
  clearCookies: boolean;
};

export class NambahAuthError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status = 500, code: string | null = null) {
    super(message);
    this.name = "NambahAuthError";
    this.status = status;
    this.code = code;
  }
}

function getAuthConfig() {
  const url = (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

  return { url, publishableKey };
}

export function isNambahAuthConfigured() {
  const { url, publishableKey } = getAuthConfig();
  return Boolean(url && publishableKey);
}

function requireAuthConfig() {
  const config = getAuthConfig();
  if (!config.url || !config.publishableKey) {
    throw new NambahAuthError(
      `Supabase Auth ${BRAND.shortName} belum dikonfigurasi.`,
      503,
      "auth_not_configured",
    );
  }
  return config;
}

function authErrorMessage(payload: AuthPayload, fallback: string) {
  return (
    payload.error_description?.trim() ||
    payload.msg?.trim() ||
    payload.message?.trim() ||
    payload.error?.trim() ||
    fallback
  );
}

async function authRequest(
  path: string,
  init: RequestInit,
  accessToken?: string,
) {
  const { url, publishableKey } = requireAuthConfig();
  const response = await fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const raw = await response.text();
  let payload: AuthPayload = {};
  try {
    payload = raw ? (JSON.parse(raw) as AuthPayload) : {};
  } catch {
    if (!response.ok) {
      throw new NambahAuthError(
        `Supabase Auth mengembalikan response tidak valid (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    throw new NambahAuthError(
      authErrorMessage(payload, "Permintaan autentikasi gagal."),
      response.status,
      payload.code ?? null,
    );
  }

  return payload;
}

function normalizeSession(payload: AuthPayload): NambahAuthSession | null {
  const candidate = payload.session ?? payload;
  if (
    !candidate ||
    typeof candidate.access_token !== "string" ||
    !candidate.access_token ||
    typeof candidate.refresh_token !== "string" ||
    !candidate.refresh_token
  ) {
    return null;
  }

  return {
    access_token: candidate.access_token,
    refresh_token: candidate.refresh_token,
    expires_in:
      typeof candidate.expires_in === "number" && candidate.expires_in > 0
        ? candidate.expires_in
        : 3600,
    token_type: candidate.token_type,
    user: candidate.user ?? payload.user ?? null,
  };
}

export async function signInNambah(input: {
  email: string;
  password: string;
}) {
  const payload = await authRequest("/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
    }),
  });

  const session = normalizeSession(payload);
  if (!session) {
    throw new NambahAuthError(
      "Supabase Auth tidak mengembalikan sesi login.",
      502,
    );
  }
  return session;
}

export async function signUpNambah(input: {
  email: string;
  password: string;
  displayName: string;
  redirectTo?: string;
}) {
  const query = input.redirectTo
    ? `?redirect_to=${encodeURIComponent(input.redirectTo)}`
    : "";

  const payload = await authRequest(`/signup${query}`, {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      data: {
        display_name: input.displayName,
      },
    }),
  });

  return {
    user: payload.user ?? payload.session?.user ?? null,
    session: normalizeSession(payload),
  };
}

/**
 * Exchanges the emailed six digit code for a session.
 *
 * This is the reason the signup template must render {{ .Token }} rather than
 * {{ .ConfirmationURL }}: verifying the code here returns a full session, so
 * the user is signed in immediately and never has to enter a password again.
 */
export async function verifySignupNambah(input: { email: string; token: string }) {
  const payload = await authRequest("/verify", {
    method: "POST",
    body: JSON.stringify({
      type: "signup",
      email: input.email,
      token: input.token,
    }),
  });

  const session = normalizeSession(payload);
  if (!session) {
    throw new NambahAuthError(
      "Kode verifikasi tidak dapat diproses.",
      400,
      "verify_failed",
    );
  }
  return session;
}

/**
 * Scopes requested from Google.
 *
 * Supabase already asks Google for exactly three: openid, email and profile.
 * They are the non-sensitive identity scopes, and an app that asks for only
 * these is exempt from Google's unverified-app treatment, which includes the
 * 100 user cap. Requesting them here as well would be misleading rather than
 * defensive: Supabase merges the scopes passed in with its own defaults
 * instead of replacing them, so it cannot pin anything.
 *
 * Do not add a Gmail, Drive or Contacts scope. Doing so would put the project
 * inside the unverified-app rules and reinstate that cap.
 */

/**
 * Builds the URL that starts the Google flow.
 *
 * The PKCE challenge travels as a query parameter while the verifier that
 * produced it is held in an httpOnly cookie, so only this app can complete the
 * exchange even if the authorization code leaks from the redirect.
 */
export function buildGoogleAuthorizeUrl(input: {
  redirectTo: string;
  codeChallenge: string;
}) {
  const { url, publishableKey } = requireAuthConfig();

  const authorize = new URL(`${url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", input.redirectTo);
  authorize.searchParams.set("code_challenge", input.codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  // Scopes are left to Supabase's default, which is GOOGLE_SCOPES_DOC. Sending
  // them explicitly produced a duplicated, not narrowed, scope parameter.
  authorize.searchParams.set("apikey", publishableKey);

  return authorize.toString();
}

/**
 * Exchanges an authorization code for a session, server-side.
 *
 * This is what lets the Google flow produce the exact same httpOnly cookies as
 * a password login. A browser-side exchange would have to hand the tokens to
 * client JavaScript first, which would put the session somewhere it does not
 * belong.
 */
export async function exchangeGoogleCode(input: {
  code: string;
  codeVerifier: string;
}) {
  const payload = await authRequest("/token?grant_type=pkce", {
    method: "POST",
    body: JSON.stringify({
      auth_code: input.code,
      code_verifier: input.codeVerifier,
    }),
  });

  const session = normalizeSession(payload);
  if (!session) {
    throw new NambahAuthError(
      "Login Google belum dapat diselesaikan.",
      502,
      "oauth_exchange_failed",
    );
  }
  return session;
}

/**
 * Sends a fresh signup code. Supabase replaces any earlier unused code, so
 * only the most recently requested one will verify.
 */
export async function resendSignupCode(input: { email: string }) {
  await authRequest("/resend", {
    method: "POST",
    body: JSON.stringify({
      type: "signup",
      email: input.email,
    }),
  });
}

/**
 * Asks Supabase to email a password recovery link.
 *
 * Callers must not branch on whether this throws. Supabase answers with an
 * error when the address is unknown, and surfacing that would turn this
 * endpoint into a way to enumerate which emails have accounts here.
 */
export async function requestPasswordRecovery(input: {
  email: string;
  redirectTo?: string;
}) {
  const query = input.redirectTo
    ? `?redirect_to=${encodeURIComponent(input.redirectTo)}`
    : "";

  await authRequest(`/recover${query}`, {
    method: "POST",
    body: JSON.stringify({ email: input.email }),
  });
}

/** Sets a new password on the user that owns the given recovery session. */
export async function updatePassword(input: {
  accessToken: string;
  password: string;
}) {
  await authRequest(
    "/user",
    {
      method: "PUT",
      body: JSON.stringify({ password: input.password }),
    },
    input.accessToken,
  );
}

export async function refreshNambahSession(refreshToken: string) {
  const payload = await authRequest("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const session = normalizeSession(payload);
  if (!session) {
    throw new NambahAuthError(
      "Supabase Auth tidak mengembalikan sesi baru.",
      401,
    );
  }
  return session;
}

export async function getNambahAuthUser(accessToken: string) {
  const payload = await authRequest(
    "/user",
    { method: "GET", body: undefined },
    accessToken,
  );

  const user = payload as NambahAuthUser;
  if (!user.id) {
    throw new NambahAuthError("Sesi pengguna tidak valid.", 401);
  }
  return user;
}

export async function signOutNambah(accessToken: string) {
  try {
    await authRequest(
      "/logout?scope=local",
      { method: "POST", body: JSON.stringify({}) },
      accessToken,
    );
  } catch (error) {
    // Local browser cookies are cleared even if the upstream session is already gone.
    if (!(error instanceof NambahAuthError) || error.status >= 500) throw error;
  }
}

function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; path?: string },
) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Cookies that carry the OAuth handshake between the authorize redirect and
 * the callback.
 *
 * The path is scoped to the two OAuth routes so these never travel with
 * ordinary page requests. SameSite=Lax is required, not a preference: the
 * callback arrives as a top-level cross-site navigation from Google, and
 * SameSite=Strict would drop the cookie and break every sign-in.
 */
const OAUTH_VERIFIER_COOKIE = "nambah_oauth_verifier";
const OAUTH_NEXT_COOKIE = "nambah_oauth_next";
const OAUTH_COOKIE_PATH = "/api/auth/google";
const OAUTH_COOKIE_MAX_AGE = 10 * 60;

export function appendNambahOAuthCookies(
  headers: Headers,
  state: { verifier: string; next: string },
) {
  headers.append(
    "Set-Cookie",
    serializeCookie(OAUTH_VERIFIER_COOKIE, state.verifier, {
      maxAge: OAUTH_COOKIE_MAX_AGE,
      path: OAUTH_COOKIE_PATH,
    }),
  );
  headers.append(
    "Set-Cookie",
    serializeCookie(OAUTH_NEXT_COOKIE, state.next, {
      maxAge: OAUTH_COOKIE_MAX_AGE,
      path: OAUTH_COOKIE_PATH,
    }),
  );
}

/**
 * Clears the OAuth cookies on both success and failure. Leaving the verifier
 * behind would let a second callback reuse it, and Supabase would reject that
 * anyway; clearing keeps the cookie jar clean either way.
 */
export function appendClearNambahOAuthCookies(headers: Headers) {
  for (const name of [OAUTH_VERIFIER_COOKIE, OAUTH_NEXT_COOKIE]) {
    headers.append(
      "Set-Cookie",
      serializeCookie(name, "", { maxAge: 0, path: OAUTH_COOKIE_PATH }),
    );
  }
}

export function readNambahOAuthState(request: Request) {
  return {
    verifier: readCookie(request, OAUTH_VERIFIER_COOKIE),
    next: readCookie(request, OAUTH_NEXT_COOKIE),
  };
}

export function appendNambahAuthSessionCookies(
  headers: Headers,
  session: NambahAuthSession,
) {
  headers.append(
    "Set-Cookie",
    serializeCookie(ACCESS_COOKIE, session.access_token, {
      maxAge: Math.max(60, session.expires_in),
    }),
  );
  headers.append(
    "Set-Cookie",
    serializeCookie(REFRESH_COOKIE, session.refresh_token, {
      maxAge: REFRESH_COOKIE_MAX_AGE,
    }),
  );
}

export function appendClearNambahAuthCookies(headers: Headers) {
  headers.append(
    "Set-Cookie",
    serializeCookie(ACCESS_COOKIE, "", { maxAge: 0 }),
  );
  headers.append(
    "Set-Cookie",
    serializeCookie(REFRESH_COOKIE, "", { maxAge: 0 }),
  );
}

export function appendResolvedNambahAuthCookies(
  headers: Headers,
  context: NambahAuthContext,
) {
  if (context.refreshedSession) {
    appendNambahAuthSessionCookies(headers, context.refreshedSession);
  } else if (context.clearCookies) {
    appendClearNambahAuthCookies(headers);
  }
}

export async function resolveNambahAuth(
  request: Request,
): Promise<NambahAuthContext> {
  if (!isNambahAuthConfigured()) {
    return { user: null, refreshedSession: null, clearCookies: false };
  }

  const accessToken = readCookie(request, ACCESS_COOKIE);
  const refreshToken = readCookie(request, REFRESH_COOKIE);

  if (accessToken) {
    try {
      const user = await getNambahAuthUser(accessToken);
      return { user, refreshedSession: null, clearCookies: false };
    } catch (error) {
      if (
        error instanceof NambahAuthError &&
        error.status >= 500 &&
        !refreshToken
      ) {
        throw error;
      }
    }
  }

  if (refreshToken) {
    try {
      const session = await refreshNambahSession(refreshToken);
      const user =
        session.user && session.user.id
          ? session.user
          : await getNambahAuthUser(session.access_token);
      return {
        user,
        refreshedSession: session,
        clearCookies: false,
      };
    } catch (error) {
      if (error instanceof NambahAuthError && error.status >= 500) throw error;
      return { user: null, refreshedSession: null, clearCookies: true };
    }
  }

  return {
    user: null,
    refreshedSession: null,
    clearCookies: Boolean(accessToken),
  };
}

export function readNambahAccessToken(request: Request) {
  return readCookie(request, ACCESS_COOKIE);
}

export function publicNambahUser(user: NambahAuthUser) {
  const metadataName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";

  return {
    id: user.id,
    email: user.email ?? "",
    displayName:
      metadataName ||
      user.email?.split("@")[0] ||
      `Pengguna ${BRAND.shortName}`,
    emailConfirmed: Boolean(user.email_confirmed_at),
    createdAt: user.created_at ?? null,
  };
}
