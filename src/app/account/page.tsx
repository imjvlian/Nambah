import AccountNav from "@/components/AccountNav";
import type { Metadata } from "next";
import AccountDashboard from "@/components/AccountDashboard";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Akun — ${BRAND.name}`,
  description: `Akun dan riwayat transaksi ${BRAND.shortName}.`,
};

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <main className="account-page">
      <SiteHeader className="account-header">
        <BrandLogo href="/" size="md" variant="horizontal" />
        <nav className="desktop-nav" aria-label="Navigasi akun">
          <a href="/">Katalog</a>
          <a href="/account">Akun</a>
        </nav>
        <div className="header-actions">
          <AccountNav />
        </div>
      </SiteHeader>

      <section className="account-shell shell">
        <AccountDashboard />
      </section>
    </main>
  );
}
