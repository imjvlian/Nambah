import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  publicNambahUser,
  resolveNambahAuth,
} from "@/lib/nambah-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await resolveNambahAuth(request);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
    });
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json({ user: null }, { status: 401, headers });
    }

    return Response.json(
      { user: publicNambahUser(auth.user) },
      { headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Nambah auth lookup failed", error);
    return Response.json(
      { error: "Sesi akun belum dapat diperiksa." },
      { status: 503 },
    );
  }
}
