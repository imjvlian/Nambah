import { optimizedBannerUrl } from "@/lib/cloudinary";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type BannerRow = {
  id: number;
  title: string;
  subtitle: string | null;
  image_url: string;
  cta_label: string | null;
  cta_href: string | null;
  promo_code: string | null;
  sort_order: number;
  display_mode: string;
  show_text_overlay: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type PromotionRow = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number | string;
  quota: number | null;
  ends_at: string | null;
};

type RedemptionCountRow = {
  promotion_code: string;
  status: string;
};

export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json({ banners: [], promotions: [] }, { status: 503 });
  }

  try {
    const now = new Date().toISOString();
    const [banners, promotions, redemptions] = await Promise.all([
      supabaseSelect<BannerRow>("promo_banners", {
        select:
          "id,title,subtitle,image_url,cta_label,cta_href,promo_code,sort_order,display_mode,show_text_overlay,starts_at,ends_at",
        filters: { active: "eq.true" },
        order: "sort_order.asc",
        limit: 10,
      }).catch(() => [] as BannerRow[]),
      supabaseSelect<PromotionRow>("promotions", {
        select: "code,name,type,value,quota,ends_at",
        filters: { active: "eq.true" },
        order: "created_at.desc",
        limit: 6,
      }).catch(() => [] as PromotionRow[]),
      supabaseSelect<RedemptionCountRow>("promotion_redemptions", {
        select: "promotion_code,status",
        limit: 10000,
      }).catch(() => [] as RedemptionCountRow[]),
    ]);

    // Pemakaian per kode — promo yang kuotanya sudah habis tidak boleh lagi
    // tampil di kartu generic, walau flag active-nya belum sempat ter-flip.
    const usageByCode = new Map<string, number>();
    for (const row of redemptions) {
      if (row.status !== "reserved" && row.status !== "redeemed") continue;
      usageByCode.set(
        row.promotion_code,
        (usageByCode.get(row.promotion_code) ?? 0) + 1,
      );
    }

    const inPeriod = banners.filter((banner) => {
      if (banner.starts_at && banner.starts_at > now) return false;
      if (banner.ends_at && banner.ends_at < now) return false;
      return true;
    });

    return Response.json(
      {
        banners: inPeriod.map((banner) => ({
          id: banner.id,
          title: banner.title,
          subtitle: banner.subtitle,
          imageUrl: optimizedBannerUrl(banner.image_url, 1200),
          ctaLabel: banner.cta_label,
          ctaHref: banner.cta_href,
          promoCode: banner.promo_code,
          displayMode: banner.display_mode ?? "carousel",
          showTextOverlay: banner.show_text_overlay ?? true,
        })),
        promotions: promotions
          .filter((promo) => !promo.ends_at || promo.ends_at > now)
          .filter(
            (promo) =>
              promo.quota === null ||
              (usageByCode.get(promo.code) ?? 0) < promo.quota,
          )
          .map((promo) => ({
            code: promo.code,
            name: promo.name,
            type: promo.type,
            value: Number(promo.value),
            endsAt: promo.ends_at,
          })),
      },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (error) {
    console.error("Public banners GET failed", error);
    return Response.json({ banners: [], promotions: [] });
  }
}
