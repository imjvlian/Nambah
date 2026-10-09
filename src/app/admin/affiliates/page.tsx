import type { Metadata } from "next";
import AffiliateAdminPanel from "@/components/AffiliateAdminPanel";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Affiliate Withdrawal Center — ${BRAND.name}`,
  description: "Admin affiliate ownership and payout workflow.",
};

export const dynamic = "force-dynamic";

export default function AffiliateAdminPage() {
  return <AffiliateAdminPanel />;
}
