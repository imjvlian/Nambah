import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  deleteBannerAsset,
  isCloudinaryConfigured,
  uploadBannerImage,
  validateBannerImage,
} from "@/lib/cloudinary";
import {
  supabaseDelete,
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type BannerRow = {
  id: number;
  title: string;
  subtitle: string | null;
  image_url: string;
  cloudinary_public_id: string | null;
  cta_label: string | null;
  cta_href: string | null;
  promo_code: string | null;
  sort_order: number;
  display_mode: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

const SELECT =
  "id,title,subtitle,image_url,cloudinary_public_id,cta_label,cta_href,promo_code,sort_order,display_mode,active,starts_at,ends_at,created_at";

const DISPLAY_MODES = new Set(["carousel", "popup", "both"]);

function mapBanner(row: BannerRow) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    imageUrl: row.image_url,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    promoCode: row.promo_code,
    sortOrder: row.sort_order,
    displayMode: row.display_mode ?? "carousel",
    active: row.active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
  };
}

function cleanText(value: FormDataEntryValue | null, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanNullable(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function cleanIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rows = await supabaseSelect<BannerRow>("promo_banners", {
      select: SELECT,
      order: "sort_order.asc",
      limit: 100,
    });
    return Response.json({
      banners: rows.map(mapBanner),
      cloudinaryReady: isCloudinaryConfigured(),
    });
  } catch (error) {
    console.error("Admin banners GET failed", error);
    return Response.json(
      { error: "Daftar banner tidak dapat dimuat." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  if (!isCloudinaryConfigured()) {
    return Response.json(
      { error: "Cloudinary belum dikonfigurasi di server." },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    const title = cleanText(form.get("title"), 120);

    if (!(file instanceof File)) {
      return Response.json({ error: "File gambar wajib diisi." }, { status: 400 });
    }
    if (title.length < 3) {
      return Response.json(
        { error: "Judul banner wajib 3–120 karakter." },
        { status: 400 },
      );
    }

    const imageError = validateBannerImage(file);
    if (imageError) {
      return Response.json({ error: imageError }, { status: 400 });
    }

    const uploaded = await uploadBannerImage(file);
    const now = new Date().toISOString();

    const rows = await supabaseInsert<BannerRow>("promo_banners", {
      title,
      subtitle: cleanText(form.get("subtitle"), 200) || null,
      image_url: uploaded.secureUrl,
      cloudinary_public_id: uploaded.publicId,
      cta_label: cleanText(form.get("ctaLabel"), 40) || null,
      cta_href: cleanText(form.get("ctaHref"), 300) || null,
      promo_code: cleanText(form.get("promoCode"), 40).toUpperCase() || null,
      display_mode: DISPLAY_MODES.has(cleanText(form.get("displayMode"), 10))
        ? cleanText(form.get("displayMode"), 10)
        : "carousel",
      sort_order: Math.max(0, Math.round(Number(cleanText(form.get("sortOrder"), 6)) || 100)),
      active: cleanText(form.get("active"), 10) !== "false",
      starts_at: cleanIso(cleanText(form.get("startsAt"), 40)),
      ends_at: cleanIso(cleanText(form.get("endsAt"), 40)),
      created_at: now,
      updated_at: now,
    });

    await auditAdminAction(request, {
      action: "banner.create",
      targetType: "banner",
      targetId: String(rows[0]?.id ?? ""),
      metadata: { title },
    });

    return Response.json({ banner: rows[0] ? mapBanner(rows[0]) : null });
  } catch (error) {
    console.error("Admin banner upload failed", error);
    return Response.json(
      { error: "Banner gagal diunggah." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Math.round(Number(body.id));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "ID banner tidak valid." }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const title = cleanNullable(body.title, 120);
      if (!title || title.length < 3) {
        return Response.json(
          { error: "Judul banner wajib 3–120 karakter." },
          { status: 400 },
        );
      }
      updates.title = title;
    }
    if (body.subtitle !== undefined) updates.subtitle = cleanNullable(body.subtitle, 200);
    if (body.ctaLabel !== undefined) updates.cta_label = cleanNullable(body.ctaLabel, 40);
    if (body.ctaHref !== undefined) updates.cta_href = cleanNullable(body.ctaHref, 300);
    if (body.promoCode !== undefined) {
      updates.promo_code = cleanNullable(body.promoCode, 40)?.toUpperCase() ?? null;
    }
    if (body.sortOrder !== undefined) {
      updates.sort_order = Math.max(0, Math.round(Number(body.sortOrder) || 0));
    }
    if (body.displayMode !== undefined) {
      const displayMode =
        typeof body.displayMode === "string" ? body.displayMode.trim() : "";
      if (!DISPLAY_MODES.has(displayMode)) {
        return Response.json(
          { error: "Display mode harus carousel, popup, atau both." },
          { status: 400 },
        );
      }
      updates.display_mode = displayMode;
    }
    if (body.active !== undefined) updates.active = Boolean(body.active);
    if (body.startsAt !== undefined) {
      updates.starts_at = cleanIso(typeof body.startsAt === "string" ? body.startsAt : "");
    }
    if (body.endsAt !== undefined) {
      updates.ends_at = cleanIso(typeof body.endsAt === "string" ? body.endsAt : "");
    }

    if (Object.keys(updates).length === 0) {
      return Response.json(
        { error: "Tidak ada perubahan yang dikirim." },
        { status: 400 },
      );
    }
    updates.updated_at = new Date().toISOString();

    const rows = await supabaseUpdate<BannerRow>("promo_banners", updates, {
      filters: { id: `eq.${id}` },
    });
    if (rows.length === 0) {
      return Response.json({ error: "Banner tidak ditemukan." }, { status: 404 });
    }

    await auditAdminAction(request, {
      action: "banner.update",
      targetType: "banner",
      targetId: String(id),
      metadata: updates,
    });

    return Response.json({ banner: mapBanner(rows[0]!) });
  } catch (error) {
    console.error("Admin banner update failed", error);
    return Response.json(
      { error: "Banner gagal diperbarui." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const id = Math.round(Number(url.searchParams.get("id")));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "ID banner tidak valid." }, { status: 400 });
    }

    const [existing] = await supabaseSelect<BannerRow>("promo_banners", {
      select: SELECT,
      filters: { id: `eq.${id}` },
      limit: 1,
    });
    if (!existing) {
      return Response.json({ error: "Banner tidak ditemukan." }, { status: 404 });
    }

    await supabaseDelete("promo_banners", { filters: { id: `eq.${id}` } });

    if (existing.cloudinary_public_id) {
      await deleteBannerAsset(existing.cloudinary_public_id);
    }

    await auditAdminAction(request, {
      action: "banner.delete",
      targetType: "banner",
      targetId: String(id),
      metadata: { title: existing.title },
    });

    return Response.json({ deleted: id });
  } catch (error) {
    console.error("Admin banner delete failed", error);
    return Response.json(
      { error: "Banner gagal dihapus." },
      { status: 502 },
    );
  }
}
