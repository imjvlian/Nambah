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
  starts_at: string | null;
  ends_at: string | null;
};

type PromotionRow = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number | string;
  ends_at: string | null;
};

export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json({ banners: [], promotions: [] }, { status: 503 });
  }

  try {
    const now = new Date().toISOString();
    const [banners, promotions] = await Promise.all([
      supabaseSelect<BannerRow>("promo_banners", {
        select:
          "id,title,subtitle,image_url,cta_label,cta_href,promo_code,sort_order,starts_at,ends_at",
        filters: { active: "eq.true" },
        order: "sort_order.asc",
        limit: 10,
      }).catch(() => [] as BannerRow[]),
      supabaseSelect<PromotionRow>("promotions", {
        select: "code,name,type,value,ends_at",
        filters: { active: "eq.true" },
        order: "created_at.desc",
        limit: 6,
      }).catch(() => [] as PromotionRow[]),
    ]);

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
        })),
        promotions: promotions
          .filter((promo) => !promo.ends_at || promo.ends_at > now)
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
