import { NambahAuthError, requestPasswordRecovery } from "@/lib/nambah-auth";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * The response here is deliberately identical whether or not the address has
 * an account.
 *
 * Supabase answers with an error for unknown addresses. Passing that through
 * would turn this endpoint into a tool for finding out who shops on this site,
 * so the wording, the status and the response time must not depend on it. The
 * only failures worth reporting are server-side ones, which carry no
 * information about whether the address exists.
 */
const NEUTRAL_RESPONSE = {
  message:
    "Kalau email itu terdaftar, kami sudah mengirim tautan untuk mengatur ulang password.",
};

export async function POST(request: Request) {
  let body: { email?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { error: "Request tidak valid." },
      { status: 400 },
    );
  }

  const email = cleanText(body.email, 254).toLowerCase();

  // A malformed address is rejected outright. That leaks nothing, since it
  // says nothing about whether the address is registered.
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Email tidak valid." }, { status: 400 });
  }

  // Per-IP limit first: without it this endpoint is a spam relay, and the
  // sending cost lands on this project's Brevo account.
  const ipLimited = await rateLimitResponse(request, {
    scope: "auth-forgot-ip",
    limit: 10,
    windowSeconds: 60 * 60,
  });
  if (ipLimited) return ipLimited;

  // Per-address limit so one inbox cannot be flooded with recovery emails.
  const emailLimited = await rateLimitResponse(request, {
    scope: "auth-forgot-email",
    limit: 3,
    windowSeconds: 60 * 60,
    subject: email,
  });
  if (emailLimited) return emailLimited;

  try {
    const origin = new URL(request.url).origin;
    await requestPasswordRecovery({
      email,
      redirectTo: `${origin}/reset-password`,
    });
  } catch (error) {
    // 4xx from Supabase here means the address is unknown. That is masked on
    // purpose. Anything else is a real failure worth surfacing.
    if (error instanceof NambahAuthError && error.status >= 500) {
      console.error("Nambah password recovery request failed", error);
      return Response.json(
        { error: "Tautan belum dapat dikirim. Coba lagi sebentar." },
        { status: 503 },
      );
    }
  }

  return Response.json(NEUTRAL_RESPONSE, { status: 200 });
}