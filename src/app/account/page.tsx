import AccountNav from "@/components/AccountNav";
import type { Metadata } from "next";
import AccountDashboard from "@/components/AccountDashboard";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Akun — Nambah",
  description: "Akun dan riwayat transaksi Nambah.",
};

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <main className="account-page">
      <SiteHeader className="account-header">
        <a className="brand" href="/">
          <span className="brand-mark"><img src="/logo/nambah-logo.svg" alt="" /></span>
          <span>Nambah</span>
        </a>
        <nav className="desktop-nav" aria-label="Navigasi akun">
          <a href="/">Katalog</a>
          <a href="/account">Akun</a>
        </nav>
        <div className="header-actions">
          <AccountNav />
          <a className="header-cta" href="/#catalog-start">Top up lagi</a>
        </div>
      </SiteHeader>

      <section className="account-shell shell">
        <AccountDashboard />
      </section>
    </main>
  );
}
