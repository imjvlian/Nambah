import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { supabaseUpdate } from "@/lib/supabase/server";

export const runtime = "nodejs";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const code =
      typeof body.code === "string"
        ? body.code.trim().toUpperCase().slice(0, 80)
        : "";
    const rawUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    const userId = rawUserId || null;

    if (!code) {
      return Response.json({ error: "Affiliate code wajib diisi." }, { status: 400 });
    }
    if (userId && !validUuid(userId)) {
      return Response.json({ error: "User ID tidak valid." }, { status: 400 });
    }

    const rows = await supabaseUpdate<{ code: string; user_id: string | null }>(
      "affiliates",
      {
        user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { filters: { code: "eq." + code } },
    );

    if (rows.length === 0) {
      return Response.json({ error: "Affiliate tidak ditemukan." }, { status: 404 });
    }

    await auditAdminAction(request, {
      action: "affiliate.link_user",
      targetType: "affiliate",
      targetId: code,
      metadata: { userId },
    });

    return Response.json({
      affiliate: {
        code: rows[0]!.code,
        userId: rows[0]!.user_id,
      },
    });
  } catch (error) {
    console.error("Affiliate user link failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Affiliate gagal dihubungkan ke user.",
      },
      { status: 409 },
    );
  }
}
