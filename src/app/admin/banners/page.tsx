import type { Metadata } from "next";
import BannerAdminPanel from "@/components/BannerAdminPanel";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Promo Banners — ${BRAND.name} Admin`,
  description: "Kelola banner promo carousel beranda.",
};

export const dynamic = "force-dynamic";

export default function BannerAdminPage() {
  return <BannerAdminPanel />;
}
