import type { Metadata } from "next";
import MelostoreAdminTabs from "@/components/MelostoreAdminTabs";
import { BRAND } from "@/lib/brand";
import { requireAdminPageScope } from "@/lib/admin-page-guard";

export const metadata: Metadata = {
  title: `Katalog Melostore - ${BRAND.name}`,
  description: "Scan katalog Melostore, tambahkan produk, dan petakan ke katalog internal.",
};

export const dynamic = "force-dynamic";

export default async function MelostoreMappingPage() {
  await requireAdminPageScope("katalog");

  return <MelostoreAdminTabs />;
}