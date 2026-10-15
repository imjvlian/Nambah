import { NambahAuthError, resendSignupCode } from "@/lib/nambah-auth";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const NEUTRAL_RESPONSE = {
  message: "Kalau email itu terdaftar, kode yang baru sudah dikirim.",
};

/**
 * Re-sends the signup code from step two of registration.
 *
 * Like the forgot-password endpoint, the answer does not vary with whether
 * the address exists. A different message or status here would confirm which
 * addresses are registered.
 */
export async function POST(request: Request) {
  let body: { email?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request tidak valid." }, { status: 400 });
  }

  const email = cleanText(body.email, 254).toLowerCase();

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Email tidak valid." }, { status: 400 });
  }

  const ipLimited = await rateLimitResponse(request, {
    scope: "auth-resend-code-ip",
    limit: 10,
    windowSeconds: 60 * 60,
  });
  if (ipLimited) return ipLimited;

  const emailLimited = await rateLimitResponse(request, {
    scope: "auth-resend-code-email",
    limit: 3,
    windowSeconds: 15 * 60,
    subject: email,
  });
  if (emailLimited) return emailLimited;

  try {
    await resendSignupCode({ email });
  } catch (error) {
    if (error instanceof NambahAuthError && error.status >= 500) {
      console.error("Nambah signup code resend failed", error);
      return Response.json(
        { error: "Kode belum dapat dikirim. Coba lagi sebentar." },
        { status: 503 },
      );
    }
  }

  return Response.json(NEUTRAL_RESPONSE, { status: 200 });
}