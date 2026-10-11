import type { Metadata } from "next";
import MelostoreAdminTabs from "@/components/MelostoreAdminTabs";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Katalog Melostore - ${BRAND.name} Admin`,
  description: "Scan katalog Melostore, tambahkan produk, dan petakan ke katalog internal.",
};

export const dynamic = "force-dynamic";

export default function MelostoreMappingPage() {
  return <MelostoreAdminTabs />;
}