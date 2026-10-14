import type { Metadata } from "next";
import AffiliateAdminPanel from "@/components/AffiliateAdminPanel";
import { BRAND } from "@/lib/brand";
import { requireAdminPageScope } from "@/lib/admin-page-guard";

export const metadata: Metadata = {
  title: `Pusat Pencairan Mitra - ${BRAND.name}`,
  description: "Kelola mitra afiliasi dan alur pencairan komisinya.",
};

export const dynamic = "force-dynamic";

export default async function AffiliateAdminPage() {
  await requireAdminPageScope("keuangan");

  return <AffiliateAdminPanel />;
}
