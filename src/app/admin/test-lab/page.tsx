import type { Metadata } from "next";
import TestLabPanel from "@/components/TestLabPanel";

export const metadata: Metadata = {
  title: "Staging Test Lab — Nambah",
  description: "Admin-only staging fulfillment scenario controls.",
};

export const dynamic = "force-dynamic";

export default function TestLabPage() {
  return <TestLabPanel />;
}
