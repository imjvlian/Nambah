import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
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
        <BrandLogo href="/" size="md" variant="horizontal" />
        <a className="text-link" href="/">Kembali ke beranda</a>
      </SiteHeader>

      <section className="auth-shell auth-shell-narrow shell">
        <ForgotPasswordForm />
      </section>
    </main>
  );
}