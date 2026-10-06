import type { Metadata } from "next";
import BannerAdminPanel from "@/components/BannerAdminPanel";

export const metadata: Metadata = {
  title: "Promo Banners — Nambah Admin",
  description: "Kelola banner promo carousel beranda.",
};

export const dynamic = "force-dynamic";

export default function BannerAdminPage() {
  return <BannerAdminPanel />;
}
