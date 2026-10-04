import AccountNav from "@/components/AccountNav";
import type { Metadata } from "next";
import AccountDashboard from "@/components/AccountDashboard";

export const metadata: Metadata = {
  title: "Akun — Nambah",
  description: "Akun dan riwayat transaksi Nambah.",
};

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <main className="account-page">
      <header className="site-header shell account-header">
        <a className="brand" href="/">
          <span className="brand-mark">N+</span>
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
      </header>

      <section className="account-shell shell">
        <AccountDashboard />
      </section>
    </main>
  );
}
