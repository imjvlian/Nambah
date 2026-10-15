import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import SiteHeader from "@/components/SiteHeader";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Lupa password — ${BRAND.name}`,
  description: `Atur ulang password akun ${BRAND.shortName}.`,
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
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
        <ForgotPasswordForm />
      </section>
    </main>
  );
}