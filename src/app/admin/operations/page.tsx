import type { Metadata } from "next";
import OperationsCenter from "@/components/OperationsCenter";

export const metadata: Metadata = {
  title: "Operations Center — Nambah",
  description: "Operational health and recovery for Nambah.",
};

export const dynamic = "force-dynamic";

export default function OperationsPage() {
  return <OperationsCenter />;
}
