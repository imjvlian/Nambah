import type { Metadata } from "next";
import AccountNav from "@/components/AccountNav";
import BrandLogo from "@/components/BrandLogo";
import OrderLookupForm from "@/components/OrderLookupForm";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { BRAND } from "@/lib/brand";
import "./cek-status.css";

export const metadata: Metadata = {
  title: `Cek Status Pesanan — ${BRAND.name}`,
  description:
    `Hilang link pesanan? Cek status order Anda dengan Order ID dan email/WhatsApp yang dipakai saat checkout di ${BRAND.shortName}.`,
};

/*
 * WAJIB force-dynamic — root layout memuat komponen client (ChatWidget)
 * dan CSP production memakai nonce per-request. Lihat src/app/refund/page.tsx.
 */
export const dynamic = "force-dynamic";

export default function CekStatusPage() {
  return (
    <main className="cek-status-page">
      <SiteHeader className="home-v2-header home-market-header">
        <BrandLogo href="/#top" size="md" variant="horizontal" />
        <div className="header-actions">
          <AccountNav />
        </div>
      </SiteHeader>

      <section className="shell cek-status-hero">
        <span className="eyebrow">Cek pesanan</span>
        <h1>Link pesananmu hilang?</h1>
        <p>
          Masukkan Order ID Anda beserta email atau WhatsApp yang Anda isi
          saat checkout — nanti Anda langsung diantar kembali ke halaman
          status pesanan Anda.
        </p>
        <OrderLookupForm />
      </section>

      <SiteFooter />
    </main>
  );
}
