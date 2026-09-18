import {
  NambahAuthError,
  appendNambahAuthSessionCookies,
  publicNambahUser,
  signUpNambah,
} from "@/lib/nambah-auth";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, {
    scope: "auth-signup",
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (limited) return limited;

  let body: {
    displayName?: unknown;
    email?: unknown;
    password?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request pendaftaran tidak valid." }, { status: 400 });
  }

  const displayName = cleanText(body.displayName, 50);
  const email = cleanText(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (displayName.length < 2) {
    return Response.json({ error: "Nama minimal 2 karakter." }, { status: 400 });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Email tidak valid." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json(
      { error: "Password minimal 8 karakter." },
      { status: 400 },
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const result = await signUpNambah({
      displayName,
      email,
      password,
      redirectTo: `${origin}/login?confirmed=1`,
    });

    if (result.session && result.session.user?.id) {
      const headers = new Headers({
        "Cache-Control": "private, no-store",
      });
      appendNambahAuthSessionCookies(headers, result.session);
      return Response.json(
        {
          user: publicNambahUser(result.session.user),
          requiresEmailConfirmation: false,
        },
        { status: 201, headers },
      );
    }

    return Response.json(
      {
        user: result.user?.id ? publicNambahUser(result.user) : null,
        requiresEmailConfirmation: true,
        message: "Akun dibuat. Cek email untuk konfirmasi sebelum login.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      const message = /already registered|already been registered/i.test(error.message)
        ? "Email sudah terdaftar. Silakan login."
        : error.message;
      return Response.json(
        { error: message },
        { status: error.status >= 500 ? 503 : error.status },
      );
    }

    console.error("Nambah signup failed", error);
    return Response.json(
      { error: "Pendaftaran belum dapat diproses." },
      { status: 503 },
    );
  }
}
