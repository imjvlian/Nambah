import { requireAdminPageScope } from "@/lib/admin-page-guard";
import AdminDocsPanel from "@/components/admin/AdminDocsPanel";

export const dynamic = "force-dynamic";

/**
 * Halaman dokumentasi dashboard admin.
 *
 * Isinya dipisah ke `AdminDocsPanel` karena penjagaan akses di sini harus
 * berjalan di server: seluruh isi panduan ada di bundle, jadi operator
 * yang tidak berhak akan tetap menerimanya kalau halamannya dirender
 * lebih dulu dan endpoint yang menolak baru menjawab belakangan.
 *
 * Yang dijaga hanya role, bukan keberadaan sesi. Halaman ini tidak pernah
 * punya penjaga autentikasi - ia mengandalkan 401 dari endpoint, dan
 * mengarahkan pengunjung yang belum masuk ke sini akan mengubah perilaku
 * yang tidak diminta.
 */
export default async function AdminDocsPage() {
  await requireAdminPageScope("alat");

  return <AdminDocsPanel />;
}