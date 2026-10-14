import type { Metadata } from "next";
import OperationsCenter from "@/components/OperationsCenter";
import { BRAND } from "@/lib/brand";
import { requireAdminPageScope } from "@/lib/admin-page-guard";

export const metadata: Metadata = {
  title: `Pusat Kendali Layanan - ${BRAND.name}`,
  description: `Kesehatan dan pemulihan seluruh layanan ${BRAND.shortName}.`,
};

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  await requireAdminPageScope("alat");

  return <OperationsCenter />;
}
