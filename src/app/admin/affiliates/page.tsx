import type { Metadata } from "next";
import AffiliateAdminPanel from "@/components/AffiliateAdminPanel";

export const metadata: Metadata = {
  title: "Affiliate Withdrawal Center — Nambah",
  description: "Admin affiliate ownership and payout workflow.",
};

export const dynamic = "force-dynamic";

export default function AffiliateAdminPage() {
  return <AffiliateAdminPanel />;
}
