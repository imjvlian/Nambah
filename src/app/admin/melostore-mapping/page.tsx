import type { Metadata } from "next";
import MelostoreMappingPanel from "@/components/MelostoreMappingPanel";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Pemetaan Melostore - ${BRAND.name} Admin`,
  description: "Periksa, pasang, dan ubah pemetaan SKU Melostore ke produk katalog.",
};

export const dynamic = "force-dynamic";

export default function MelostoreMappingPage() {
  return <MelostoreMappingPanel />;
}