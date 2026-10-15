import {
  NambahAuthError,
  appendNambahAuthSessionCookies,
  publicNambahUser,
  signUpNambah,
} from "@/lib/nambah-auth";
import {
  passwordConfirmationError,
  passwordPolicyError,
} from "@/lib/password-strength";
import { rateLimitResponse } from "@/lib/rate-limit";
import { resolveSiteUrl, resolveSiteOrigin } from "@/lib/site-url";
import { getClientIp, verifyTurnstileToken } from "@/lib/turnstile";

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
    confirmPassword?: unknown;
    turnstileToken?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request pendaftaran tidak valid." }, { status: 400 });
  }

  const token =
    typeof body.turnstileToken === "string" ? body.turnstileToken.trim() : "";

  const captchaValid = await verifyTurnstileToken(token, getClientIp(request));
  if (!captchaValid) {
    return Response.json({ error: "Captcha tidak valid. Coba lagi." }, { status: 403 });
  }

  const displayName = cleanText(body.displayName, 50);
  const email = cleanText(body.email, 254).toLowerCase();
  // Passwords are never trimmed. Leading and trailing spaces are legitimate
  // characters, and silently stripping them would let a password pass
  // validation as one thing and then be stored as another.
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (displayName.length < 2) {
    return Response.json({ error: "Nama minimal 2 karakter." }, { status: 400 });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Email tidak valid." }, { status: 400 });
  }

  const policyError = passwordPolicyError(password, email);
  if (policyError) {
    return Response.json({ error: policyError }, { status: 400 });
  }

  const confirmationError = passwordConfirmationError(password, confirmPassword);
  if (confirmationError) {
    return Response.json({ error: confirmationError }, { status: 400 });
  }

  // A per-address limit on top of the per-IP one. Without it, signup doubles
  // as a way to bury someone's inbox with signup emails, since the sender
  // address on those is this project.
  const addressLimited = await rateLimitResponse(request, {
    scope: "auth-signup-address",
    limit: 3,
    windowSeconds: 60 * 60,
    subject: email,
  });
  if (addressLimited) return addressLimited;

  try {
    const result = await signUpNambah({
      displayName,
      email,
      password,
      redirectTo:
        `${resolveSiteOrigin(request)}/login?confirmed=1`,
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
        message: "Kode 6 digit sudah dikirim ke emailmu. Masukkan kode itu untuk selesai mendaftar.",
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
