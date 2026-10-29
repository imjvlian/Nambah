import type { Metadata } from "next";
import PaymentMethodsAdminPanel from "@/components/PaymentMethodsAdminPanel";
import { BRAND } from "@/lib/brand";
import { requireAdminPageScope } from "@/lib/admin-page-guard";

export const metadata: Metadata = {
  title: `Biaya Layanan — ${BRAND.name}`,
  description: "Kelola biaya layanan per metode pembayaran.",
};

export const dynamic = "force-dynamic";

export default async function PaymentMethodsAdminPage() {
  await requireAdminPageScope("pertumbuhan");

  return <PaymentMethodsAdminPanel />;
}
