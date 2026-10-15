import {
  NambahAuthError,
  appendNambahAuthSessionCookies,
  publicNambahUser,
  refreshNambahSession,
  updatePassword,
} from "@/lib/nambah-auth";
import {
  passwordConfirmationError,
  passwordPolicyError,
} from "@/lib/password-strength";
import { rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_TOKEN_LENGTH = 4096;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * Completes a password reset.
 *
 * The recovery link from the email lands on the browser carrying the session
 * in the URL fragment, which browsers never send to a server. The page reads
 * it and posts it here, where the password policy is checked and the new
 * password is written through Supabase.
 *
 * Anyone completing a reset is choosing a fresh password, so the same rules
 * as signup apply. Older passwords are left alone only because nothing forces
 * a change; this route is opt-in by definition.
 */
export async function POST(request: Request) {
  let body: {
    accessToken?: unknown;
    refreshToken?: unknown;
    password?: unknown;
    confirmPassword?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request tidak valid." }, { status: 400 });
  }

  const accessToken = cleanText(body.accessToken, MAX_TOKEN_LENGTH);
  const refreshToken = cleanText(body.refreshToken, MAX_TOKEN_LENGTH);
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (!accessToken || !refreshToken) {
    return Response.json(
      { error: "Tautan pengaturan ulang tidak valid. Minta tautan baru." },
      { status: 400 },
    );
  }

  // Policy is checked before the token is used, so a caller cannot burn
  // attempts on a weak password.
  const policyError = passwordPolicyError(password, "");
  if (policyError) {
    return Response.json({ error: policyError }, { status: 400 });
  }

  const confirmationError = passwordConfirmationError(password, confirmPassword);
  if (confirmationError) {
    return Response.json({ error: confirmationError }, { status: 400 });
  }

  const limited = await rateLimitResponse(request, {
    scope: "auth-reset",
    limit: 10,
    windowSeconds: 60 * 60,
  });
  if (limited) return limited;

  try {
    // Refresh first rather than trusting the token straight out of the URL:
    // the access token carried in a recovery link may be close to expiry, and
    // the cookies written afterwards need to outlive the response.
    const session = await refreshNambahSession(refreshToken);
    await updatePassword({ accessToken: session.access_token, password });

    const headers = new Headers({ "Cache-Control": "private, no-store" });
    appendNambahAuthSessionCookies(headers, session);

    return Response.json(
      { user: session.user?.id ? publicNambahUser(session.user) : null },
      { status: 200, headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      if (error.status >= 500) {
        console.error("Nambah password reset failed", error);
        return Response.json(
          { error: "Password belum dapat disimpan. Coba lagi sebentar." },
          { status: 503 },
        );
      }
      // The recovery session is gone: expired, already used, or revoked. The
      // only way forward is a new link, and saying so is what lets the page
      // offer that instead of leaving the person stuck.
      return Response.json(
        {
          error:
            "Tautan pengaturan ulang sudah tidak berlaku. Minta tautan baru.",
        },
        { status: 401 },
      );
    }

    console.error("Nambah password reset failed", error);
    return Response.json(
      { error: "Password belum dapat disimpan." },
      { status: 503 },
    );
  }
}