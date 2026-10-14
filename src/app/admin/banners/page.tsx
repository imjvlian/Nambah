import type { Metadata } from "next";
import BannerAdminPanel from "@/components/BannerAdminPanel";
import { BRAND } from "@/lib/brand";
import { requireAdminPageScope } from "@/lib/admin-page-guard";

export const metadata: Metadata = {
  title: `Banner Promo — ${BRAND.name}`,
  description: "Kelola banner promo carousel beranda.",
};

export const dynamic = "force-dynamic";

export default async function BannerAdminPage() {
  await requireAdminPageScope("pertumbuhan");

  return <BannerAdminPanel />;
}
