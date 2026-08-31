import type { Metadata } from "next";
import Link from "next/link";
import AdminDashboard from "@/components/AdminDashboard";
import AdminCatalogTools from "@/components/AdminCatalogTools";

export const metadata: Metadata = {
  title: "Admin Katalog — Nambah",
  description: "Kelola katalog, mapping supplier, dan sinkronisasi Nambah.",
};

export default function AdminPage() {
  return (
    <>
      <AdminDashboard />
      <AdminCatalogTools />
      <Link className="supplier-catalog-fab" href="/admin/digiflazz">
        Katalog Digiflazz →
      </Link>
    </>
  );
}
