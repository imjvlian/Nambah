import type { Metadata } from "next";
import ResetPasswordForm from "@/components/ResetPasswordForm";
import SiteHeader from "@/components/SiteHeader";
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
        <a className="brand" href="/">
          <span className="brand-mark"><img src="/logo/lacte-logo.svg" alt="" /></span>
          <span>{BRAND.shortName}</span>
        </a>
        <a className="text-link" href="/">Kembali ke beranda</a>
      </SiteHeader>

      <section className="auth-shell auth-shell-narrow shell">
        <ResetPasswordForm />
      </section>
    </main>
  );
}