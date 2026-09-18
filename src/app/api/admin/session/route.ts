import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  createAdminSessionValue,
  isAdminApiConfigured,
  isAdminRequestAuthorized,
  verifyAdminToken,
} from "@/lib/admin-api";
import { getNambahAdminAccount } from "@/lib/admin-account";
import {
  appendResolvedNambahAuthCookies,
  publicNambahUser,
  resolveNambahAuth,
} from "@/lib/nambah-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const configured = isAdminApiConfigured();
  if (!configured) {
    return Response.json({
      configured: false,
      authenticated: false,
      error: "Admin session secret belum dikonfigurasi.",
    });
  }

  try {
    const legacyAuthorized = isAdminRequestAuthorized(request);
    const auth = await resolveNambahAuth(request);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
    });
    appendResolvedNambahAuthCookies(headers, auth);

    if (auth.user) {
      const admin = await getNambahAdminAccount(auth.user.id);

      if (admin) {
        if (!legacyAuthorized) {
          headers.append(
            "Set-Cookie",
            createAdminSessionCookie(createAdminSessionValue()),
          );
        }

        return Response.json(
          {
            configured: true,
            authenticated: true,
            accountAuthenticated: true,
            mode: "account",
            role: admin.role,
            user: publicNambahUser(auth.user),
          },
          { headers },
        );
      }

      if (!legacyAuthorized) {
        return Response.json(
          {
            configured: true,
            authenticated: false,
            accountAuthenticated: true,
            forbidden: true,
            user: publicNambahUser(auth.user),
          },
          { headers },
        );
      }
    }

    if (legacyAuthorized) {
      return Response.json(
        {
          configured: true,
          authenticated: true,
          accountAuthenticated: Boolean(auth.user),
          mode: "legacy",
          user: auth.user ? publicNambahUser(auth.user) : null,
        },
        { headers },
      );
    }

    return Response.json(
      {
        configured: true,
        authenticated: false,
        accountAuthenticated: false,
      },
      { headers },
    );
  } catch (error) {
    console.error("Admin account session lookup failed", error);
    return Response.json(
      {
        configured: true,
        authenticated: false,
        error:
          "Akses admin belum dapat diperiksa. Pastikan migration admin sudah dijalankan.",
      },
      { status: 503 },
    );
  }
}

// Legacy token exchange is intentionally retained as an emergency/recovery path.
// The dashboard no longer asks users to type this token.
export async function POST(request: Request) {
  if (!isAdminApiConfigured()) {
    return Response.json(
      { error: "Admin session secret belum dikonfigurasi." },
      { status: 503 },
    );
  }

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return Response.json(
      { error: "Request login admin tidak valid." },
      { status: 400 },
    );
  }

  const token = body.token?.trim() ?? "";
  if (!verifyAdminToken(token)) {
    return Response.json(
      { error: "Token admin tidak valid." },
      { status: 401 },
    );
  }

  const session = createAdminSessionValue();
  return Response.json(
    { authenticated: true, mode: "legacy" },
    { headers: { "Set-Cookie": createAdminSessionCookie(session) } },
  );
}

export async function DELETE() {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearAdminSessionCookie() } },
  );
}
