import {
  NambahAuthError,
  appendNambahAuthSessionCookies,
  publicNambahUser,
  verifySignupNambah,
} from "@/lib/nambah-auth";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const CODE_LENGTH = 6;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * Turns Supabase's OTP failures into something a person can act on.
 *
 * The distinction that matters is between a code that was wrong and a code
 * that will never work again. Telling someone to retype a code that has
 * expired just wastes a second attempt, so those two cases are reported
 * differently.
 */
function verificationMessage(error: NambahAuthError) {
  const text = `${error.code ?? ""} ${error.message}`.toLowerCase();

  if (text.includes("expired")) {
    return "Kode sudah kedaluwarsa. Minta kode baru.";
  }
  if (text.includes("email") && text.includes("not") && text.includes("confirmed")) {
    return "Email belum dikonfirmasi. Minta kode baru.";
  }
  if (text.includes("rate") || text.includes("too many")) {
    return "Terlalu banyak percobaan. Tunggu sebentar lalu minta kode baru.";
  }
  return "Kode verifikasi salah. Periksa kembali.";
}

export async function POST(request: Request) {
  let body: { email?: unknown; code?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { error: "Request verifikasi tidak valid." },
      { status: 400 },
    );
  }

  const email = cleanText(body.email, 254).toLowerCase();
  const code = cleanText(body.code, CODE_LENGTH);

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Email tidak valid." }, { status: 400 });
  }
  if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) {
    return Response.json(
      { error: `Kode verifikasi harus ${CODE_LENGTH} angka.` },
      { status: 400 },
    );
  }

  // Per-email first. A six digit code is only a million combinations, so the
  // counter has to follow the address: without this, rotating IP addresses
  // would give an attacker unlimited guesses at any single inbox.
  const emailLimited = await rateLimitResponse(request, {
    scope: "auth-verify-signup-email",
    limit: 5,
    windowSeconds: 15 * 60,
    subject: email,
  });
  if (emailLimited) return emailLimited;

  // Per-IP as well, so one machine cannot grind through many addresses.
  const ipLimited = await rateLimitResponse(request, {
    scope: "auth-verify-signup-ip",
    limit: 30,
    windowSeconds: 15 * 60,
  });
  if (ipLimited) return ipLimited;

  try {
    const session = await verifySignupNambah({ email, token: code });

    if (!session.user?.id) {
      return Response.json(
        { error: "Kode verifikasi tidak dapat diproses." },
        { status: 502 },
      );
    }

    const headers = new Headers({ "Cache-Control": "private, no-store" });
    appendNambahAuthSessionCookies(headers, session);

    return Response.json(
      { user: publicNambahUser(session.user) },
      { status: 200, headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      if (error.status >= 500) {
        console.error("Nambah signup verification failed", error);
        return Response.json(
          { error: "Kode verifikasi belum dapat diperiksa. Coba lagi." },
          { status: 503 },
        );
      }
      return Response.json(
        { error: verificationMessage(error) },
        { status: 400 },
      );
    }

    console.error("Nambah signup verification failed", error);
    return Response.json(
      { error: "Kode verifikasi belum dapat diproses." },
      { status: 503 },
    );
  }
}