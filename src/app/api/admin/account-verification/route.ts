import {
  authorizeAdminRequest,
  getAdminRequestPrincipal,
} from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  getAccountVerificationMode,
  isAccountVerificationMode,
  setAccountVerificationMode,
} from "@/lib/account-verification-settings";

export const runtime = "nodejs";

/**
 * Baca / ubah mode gerbang verifikasi akun — KILL-SWITCH untuk P0 gate.
 *
 * Diikuti preseden `payment-settings`: flag `app_settings` yang mengubah
 * perilaku checkout adalah kontrol Sistem, jadi route ini terdaftar di
 * ROUTES_INTENTIONALLY_CLOSED (`admin-scope.ts`) dan hanya superadmin
 * yang boleh mengubahnya. Audit log mencatat siapa mengubah apa.
 *
 *   GET /api/admin/account-verification            -> { mode }
 *   PUT /api/admin/account-verification { mode }   -> { mode }
 *
 * Urutan aktivasi yang disarankan: off -> log (shadow beberapa hari,
 * cek false negative di kolom audit) -> enforce.
 */

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const mode = await getAccountVerificationMode();
  return Response.json(
    { mode },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PUT(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: { mode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request tidak valid." }, { status: 400 });
  }

  if (!isAccountVerificationMode(body.mode)) {
    return Response.json(
      { error: "Mode harus salah satu dari: off, log, enforce." },
      { status: 400 },
    );
  }

  const mode = await setAccountVerificationMode(body.mode);
  const principal = getAdminRequestPrincipal(request);

  await auditAdminAction(request, {
    action: "account_verification.set_mode",
    targetType: "app_settings",
    targetId: "account_verification_mode",
    metadata: { mode, actorUserId: principal?.userId ?? null },
  });

  return Response.json(
    { mode },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
