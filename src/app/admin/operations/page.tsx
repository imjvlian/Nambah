import type { Metadata } from "next";
import OperationsCenter from "@/components/OperationsCenter";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Operations Center — ${BRAND.name}`,
  description: `Operational health and recovery for ${BRAND.shortName}.`,
};

export const dynamic = "force-dynamic";

export default function OperationsPage() {
  return <OperationsCenter />;
}
