import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { reviewedByUserId } from "@/lib/admin-identity";
import {
  AFFILIATE_CODE_PATTERN,
  generateAffiliateCode,
  normalizeAffiliateCode,
} from "@/lib/affiliate-code";
import {
  supabaseAuthAdminGetUser,
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Review permintaan affiliate: approve / reject.
 *
 * Commission rate di sini, TIDAK dari request. Nilai itu keputusan admin —
 * kalau diambil dari pemohon, pembeli bisa memilih komisinya sendiri.
 *
 * Approve membuat baris di `affiliates`. Baris itu yang dibaca
 * `pricing-repository.ts` saat checkout, jadi affiliate langsung bisa dipakai
 * tanpa langkah lain.
 */

type RequestRow = {
  id: number;
  user_id: string;
  display_name: string;
  whatsapp: string;
  motivation: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  other_url: string;
  status: "pending" | "approved" | "rejected";
  granted_code: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "pending";
    const allowed = new Set(["pending", "approved", "rejected", "all"]);
    if (!allowed.has(status)) {
      return Response.json(
        { error: "Status harus pending, approved, rejected, atau all." },
        { status: 400 },
      );
    }

    const rows = await supabaseSelect<RequestRow>("affiliate_requests", {
      select:
        "id,user_id,display_name,whatsapp,motivation,instagram,tiktok,youtube,other_url,status,granted_code,rejection_reason,created_at",
      ...(status === "all" ? {} : { filters: { status: `eq.${status}` } }),
      order: "created_at.desc",
      limit: 200,
    });

    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;

    return Response.json({
      requests: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        displayName: row.display_name,
        whatsapp: row.whatsapp,
        motivation: row.motivation,
        instagram: row.instagram,
        tiktok: row.tiktok,
        youtube: row.youtube,
        otherUrl: row.other_url,
        status: row.status,
        grantedCode: row.granted_code,
        rejectionReason: row.rejection_reason,
        createdAt: row.created_at,
      })),
      counts,
      status,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Request tidak dapat dimuat.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  // Otorisasi sudah dijamin di atas. Nilai ini hanya untuk jejak audit
  // `reviewed_by`, dan `null` berarti "sesi tanpa identitas user".
  const actorUserId = reviewedByUserId(auth);

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "ID request tidak valid." }, { status: 400 });
    }

    const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
    if (!decision) {
      return Response.json(
        { error: "Keputusan harus approve atau reject." },
        { status: 400 },
      );
    }

    const [row] = await supabaseSelect<RequestRow>("affiliate_requests", {
      select:
        "id,user_id,display_name,whatsapp,motivation,instagram,tiktok,youtube,other_url,status,granted_code,rejection_reason,created_at",
      filters: { id: `eq.${id}` },
      limit: 1,
    });
    if (!row) {
      return Response.json({ error: "Request tidak ditemukan." }, { status: 404 });
    }

    // Hanya pending yang bisa diputus. Kalau approve dipanggil dua kali,
    // affiliate kedua tidak boleh dibuat dengan kode berbeda.
    if (row.status !== "pending") {
      return Response.json(
        { error: `Request ini sudah ${row.status}.` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    if (decision === "reject") {
      const reason =
        typeof body.rejectionReason === "string" ? body.rejectionReason.trim() : "";
      if (reason.length < 5 || reason.length > 500) {
        return Response.json(
          { error: "Alasan penolakan wajib diisi (5-500 karakter)." },
          { status: 400 },
        );
      }

      await supabaseUpdate<RequestRow>(
        "affiliate_requests",
        {
          status: "rejected",
          rejection_reason: reason,
          reviewed_by: actorUserId,
          reviewed_at: now,
          updated_at: now,
        },
        { filters: { id: `eq.${id}`, status: "eq.pending" } },
      );

      await auditAdminAction(request, {
        action: "affiliate_request.reject",
        targetType: "affiliate_request",
        targetId: String(id),
        metadata: { userId: row.user_id, reason },
      });

      return Response.json({ status: "rejected", id });
    }

    // ── Approve ───────────────────────────────────────────────────────────
    // Rate dari admin. Wajib diisi eksplisit supaya tidak diam-diam memakai
    // default yang berbeda dari yang(admin) bayangkan.
    const commissionRate = Number(body.commissionRate);
    if (
      !Number.isFinite(commissionRate) ||
      commissionRate < 0 ||
      commissionRate > 1
    ) {
      return Response.json(
        { error: "Commission rate wajib diisi antara 0 dan 1 (0.2 = 20%)." },
        { status: 400 },
      );
    }

    // Akunnya harus benar-benar ada di Supabase Auth. `affiliates.user_id`
    // tidak punya FK ke auth.users, jadi tanpa cek ini affiliate bisa dibuat
    // untuk user yang tidak ada — payout-nya tidak akan pernah bisa cair.
    const authUser = await supabaseAuthAdminGetUser(row.user_id);
    if (!authUser) {
      return Response.json(
        { error: "User dengan ID ini tidak ditemukan di sistem auth." },
        { status: 400 },
      );
    }

    const isTaken = async (code: string) => {
      const [found] = await supabaseSelect<{ code: string }>("affiliates", {
        select: "code",
        filters: { code: `eq.${code}` },
        limit: 1,
      });
      return Boolean(found);
    };

    // Kode dari admin wins kalau valid dan belum dipakai. Kalau tidak, generate.
    let code = "";
    const requested = normalizeAffiliateCode(
      typeof body.code === "string" ? body.code : "",
    );
    if (requested) {
      if (!AFFILIATE_CODE_PATTERN.test(requested)) {
        return Response.json(
          { error: "Kode hanya boleh huruf besar, angka, - atau _ (3-40 karakter)." },
          { status: 400 },
        );
      }
      if (await isTaken(requested)) {
        return Response.json(
          { error: `Kode ${requested} sudah dipakai.` },
          { status: 409 },
        );
      }
      code = requested;
    } else {
      const generated = await generateAffiliateCode(row.display_name, isTaken);
      if (!generated) {
        return Response.json(
          { error: "Kode otomatis gagal dibuat dari nama ini. Isi kode manual." },
          { status: 400 },
        );
      }
      code = generated;
    }

    // Default: diskon flat 0 dan minimum order 0. Admin bisa mengubahnya
    // setelahnya lewat PATCH /api/admin/affiliates.
    const userBenefitType = "flat";
    const userBenefitValue = 0;
    const minimumOrder = 0;

    const [created] = await supabaseInsert<{ code: string }>(
      "affiliates",
      {
        code,
        display_name: row.display_name,
        user_id: row.user_id,
        commission_rate: commissionRate,
        user_benefit_type: userBenefitType,
        user_benefit_value: userBenefitValue,
        minimum_order: minimumOrder,
        max_user_benefit: null,
        stackable_with_promotions: true,
        status: "active",
        created_at: now,
        updated_at: now,
      },
    );

    if (!created?.code) {
      return Response.json(
        { error: "Affiliate gagal dibuat." },
        { status: 500 },
      );
    }

    await supabaseUpdate<RequestRow>(
      "affiliate_requests",
      {
        status: "approved",
        granted_code: code,
        commission_rate: commissionRate,
        reviewed_by: actorUserId,
        reviewed_at: now,
        updated_at: now,
      },
      { filters: { id: `eq.${id}`, status: "eq.pending" } },
    );

    await auditAdminAction(request, {
      action: "affiliate_request.approve",
      targetType: "affiliate_request",
      targetId: String(id),
      metadata: { userId: row.user_id, code, commissionRate },
    });

    return Response.json({ status: "approved", id, code, commissionRate });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Keputusan tidak dapat diproses.",
      },
      { status: 500 },
    );
  }
}
