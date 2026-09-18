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
      "Supabase Auth Nambah belum dikonfigurasi.",
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
  options: { maxAge: number },
) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
  ]
    .filter(Boolean)
    .join("; ");
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
      "Pengguna Nambah",
    emailConfirmed: Boolean(user.email_confirmed_at),
    createdAt: user.created_at ?? null,
  };
}
