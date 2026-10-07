import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";
export default function NotFound() {
  return (
    <main className="shell" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px", padding: "40px 20px", textAlign: "center" }}>
      <BrandLogo size="lg" variant="horizontal" />
      <h1 className="display" style={{ fontSize: "clamp(48px, 10vw, 96px)" }}>404</h1>
      <p style={{ color: "var(--muted)" }}>Halaman yang kamu cari tidak ditemukan. {BRAND.tagline}</p>
      <Link href="/" className="header-cta">Kembali ke beranda</Link>
    </main>
  );
}