import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  createAdminSessionValue,
  isAdminApiConfigured,
  isAdminRequestAuthorized,
  verifyAdminToken,
} from "@/lib/admin-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json({
    configured: isAdminApiConfigured(),
    authenticated: isAdminRequestAuthorized(request),
  });
}

export async function POST(request: Request) {
  if (!isAdminApiConfigured()) {
    return Response.json(
      { error: "Admin API token belum dikonfigurasi." },
      { status: 503 },
    );
  }

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return Response.json({ error: "Request login admin tidak valid." }, { status: 400 });
  }

  const token = body.token?.trim() ?? "";
  if (!verifyAdminToken(token)) {
    return Response.json({ error: "Token admin tidak valid." }, { status: 401 });
  }

  const session = createAdminSessionValue();
  return Response.json(
    { authenticated: true },
    { headers: { "Set-Cookie": createAdminSessionCookie(session) } },
  );
}

export async function DELETE() {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearAdminSessionCookie() } },
  );
}
