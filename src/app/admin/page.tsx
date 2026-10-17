import type { Metadata } from "next";
import AdminDashboard from "@/components/AdminDashboard";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} Control Center`,
  description:
    `Operations dashboard untuk order, catalog, supplier, receipt, growth, user, dan sistem ${BRAND.shortName}.`,
};

/*
 * WAJIB force-dynamic - jangan dihapus tanpa membaca `src/lib/csp.ts`.
 *
 * Halaman ini stateless: isinya nol data, cuma merender `<AdminDashboard />`
 * yang ambil datanya sendiri lewat fetch ke /api/admin/*. Tidak ada satu pun
 * alasan performanya untuk di-prerender.
 *
 * DAN ia tidak BISA di-prerender. `middleware` memasang CSP dengan nonce
 * BARU setiap request (`'nonce-<uuid>'` + `'strict-dynamic'`), sedangkan HTML
 * yang di-prerender dibakar saat build - saat tidak ada request, jadi tidak ada
 * nonce untuk disisipkan ke tag <script>. Akibatnya setiap script ditolak
 * browser dan halaman tersangkut di "Memuat ..." selamanya.
 *
 * Halaman static yang memuat client component WAJIB punya baris ini.
 * `tests/csp-static-page.test.ts` menjaga aturannya.
 */
export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminDashboard />;
}
