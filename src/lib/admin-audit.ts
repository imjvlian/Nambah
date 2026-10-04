import { createHash } from "node:crypto";
import { getAdminRequestPrincipal } from "@/lib/admin-api";
import { supabaseInsert } from "@/lib/supabase/server";

function actorKind(request: Request) {
  const principal = getAdminRequestPrincipal(request);
  if (principal?.mode === "account") return "admin_account";
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? "legacy_bearer" : "admin_session";
}

function clientHash(request: Request) {
  const raw =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256")
    .update(raw.split(",")[0]?.trim() || "unknown")
    .digest("hex");
}

export async function auditAdminAction(
  request: Request,
  input: {
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    const url = new URL(request.url);
    const principal = getAdminRequestPrincipal(request);
    await supabaseInsert("admin_audit_logs", {
      actor_kind: actorKind(request),
      actor_user_id: principal?.userId ?? null,
      actor_role: principal?.role ?? null,
      action: input.action.slice(0, 120),
      target_type: input.targetType?.slice(0, 80) ?? null,
      target_id: input.targetId?.slice(0, 160) ?? null,
      method: request.method,
      path: url.pathname.slice(0, 300),
      client_hash: clientHash(request),
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin audit log failed", error);
  }
}
