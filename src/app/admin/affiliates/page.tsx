import type { Metadata } from "next";
import AffiliateAdminPanel from "@/components/AffiliateAdminPanel";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Pusat Pencairan Mitra - ${BRAND.name}`,
  description: "Kelola mitra afiliasi dan alur pencairan komisinya.",
};

export const dynamic = "force-dynamic";

export default function AffiliateAdminPage() {
  return <AffiliateAdminPanel />;
}
