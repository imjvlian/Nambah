import {
  NambahAuthError,
  appendNambahAuthSessionCookies,
  publicNambahUser,
  signInNambah,
} from "@/lib/nambah-auth";

export const runtime = "nodejs";

function cleanEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return Response.json({ error: "Request login tidak valid." }, { status: 400 });
  }

  const email = cleanEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Email tidak valid." }, { status: 400 });
  }
  if (!password) {
    return Response.json({ error: "Password wajib diisi." }, { status: 400 });
  }

  try {
    const session = await signInNambah({ email, password });
    const user = session.user;
    if (!user?.id) {
      return Response.json(
        { error: "Login berhasil tetapi data pengguna tidak tersedia." },
        { status: 502 },
      );
    }

    const headers = new Headers({
      "Cache-Control": "private, no-store",
    });
    appendNambahAuthSessionCookies(headers, session);
    return Response.json({ user: publicNambahUser(user) }, { headers });
  } catch (error) {
    if (error instanceof NambahAuthError) {
      const message = /invalid login credentials/i.test(error.message)
        ? "Email atau password salah."
        : /email not confirmed/i.test(error.message)
          ? "Email belum dikonfirmasi. Buka email dari Nambah lalu coba login lagi."
          : error.message;
      return Response.json(
        { error: message },
        { status: error.status >= 500 ? 503 : 401 },
      );
    }

    console.error("Nambah login failed", error);
    return Response.json({ error: "Login belum dapat diproses." }, { status: 503 });
  }
}
