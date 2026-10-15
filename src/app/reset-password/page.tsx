import type { Metadata } from "next";
import ResetPasswordForm from "@/components/ResetPasswordForm";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Password baru — ${BRAND.name}`,
  description: `Buat password baru untuk akun ${BRAND.shortName}.`,
  // This page is reached from a one-time link and must never be indexed.
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <main className="auth-page">
      <SiteHeader className="auth-header">
        <BrandLogo href="/" size="md" variant="horizontal" />
        <a className="text-link" href="/">Kembali ke beranda</a>
      </SiteHeader>

      <section className="auth-shell auth-shell-narrow shell">
        <ResetPasswordForm />
      </section>
    </main>
  );
}