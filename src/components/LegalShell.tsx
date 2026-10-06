import Link from "next/link";

export default function LegalShell({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="legal-page">
      <nav className="legal-nav" aria-label="Navigasi legal">
        <Link href="/">← Kembali ke beranda</Link>
        <Link href="/#catalog-start">Top up</Link>
      </nav>

      <header>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <span className="legal-updated">Terakhir diperbarui: {updated}</span>
      </header>

      {children}

      <footer className="legal-footer-links">
        <Link href="/privacy">Kebijakan Privasi</Link>
        <Link href="/terms">Ketentuan Layanan</Link>
        <Link href="/refund">Kebijakan Pengembalian Dana</Link>
      </footer>
    </main>
  );
}
