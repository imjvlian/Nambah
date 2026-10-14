import type { Metadata } from "next";
import { redirect } from "next/navigation";
import TestLabPanel from "@/components/TestLabPanel";
import { BRAND } from "@/lib/brand";
import { isTestLabEnabled } from "@/lib/test-lab-access";

export const metadata: Metadata = {
  title: `Laboratorium Uji - ${BRAND.name}`,
  description: "Kontrol skenario fulfilment untuk pengujian, khusus admin.",
};

export const dynamic = "force-dynamic";

/**
 * Halaman dibRedirect, bukan disembunyikan lewat CSS atau `notFound()`.
 *
 * Alasannya: sidebar tidak menampilkan entri ini saat aksesnya tertutup,
 * jadi halaman yang benar-benar ada tapi tidak bisa dicapai hanya menambah
 * satu cara untuk menemukan alat uji di build produksi. Redirect menutup
 * jalannya sepenuhnya, dan `dynamic = "force-dynamic"` memastikan
 * pemeriksaan ini dievaluasi per request - bukan saat build, ketika env
 * produksi belum tentu terbaca.
 */
export default function TestLabPage() {
  if (!isTestLabEnabled()) redirect("/admin/operations");

  return <TestLabPanel />;
}