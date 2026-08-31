import type { Metadata } from "next";
import Link from "next/link";
import AdminDashboard from "@/components/AdminDashboard";
import AdminCatalogTools from "@/components/AdminCatalogTools";

export const metadata: Metadata = {
  title: "Admin Katalog — Nambah",
  description: "Kelola katalog Nambah yang dipilih dari katalog supplier Digiflazz.",
};

export default function AdminPage() {
  return (
    <>
      <AdminDashboard />
      <AdminCatalogTools />
      <Link className="supplier-catalog-fab" href="/admin/digiflazz">
        Scan & pilih produk Digiflazz →
      </Link>
    </>
  );
}
