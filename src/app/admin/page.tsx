import type { Metadata } from "next";
import AdminDashboard from "@/components/AdminDashboard";

export const metadata: Metadata = {
  title: "Admin Katalog — Nambah",
  description: "Kelola katalog, mapping supplier, dan sinkronisasi Nambah.",
};

export default function AdminPage() {
  return <AdminDashboard />;
}
