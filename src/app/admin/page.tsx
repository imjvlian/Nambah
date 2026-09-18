import type { Metadata } from "next";
import AdminDashboard from "@/components/AdminDashboard";

export const metadata: Metadata = {
  title: "Nambah Control Center",
  description:
    "Operations dashboard untuk order, catalog, supplier, receipt, growth, user, dan system Nambah.",
};

export default function AdminPage() {
  return <AdminDashboard />;
}
