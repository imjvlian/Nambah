import DigiflazzCatalogBrowserV2 from "@/components/DigiflazzCatalogBrowserV2";
import { requireAdminPageScope } from "@/lib/admin-page-guard";

export const dynamic = "force-dynamic";

export default async function DigiflazzAdminPage() {
  await requireAdminPageScope("katalog");

  return <DigiflazzCatalogBrowserV2 />;
}