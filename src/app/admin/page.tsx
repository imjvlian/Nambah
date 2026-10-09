import type { Metadata } from "next";
import AdminDashboard from "@/components/AdminDashboard";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} Control Center`,
  description:
    `Operations dashboard untuk order, catalog, supplier, receipt, growth, user, dan sistem ${BRAND.shortName}.`,
};

export default function AdminPage() {
  return <AdminDashboard />;
}
