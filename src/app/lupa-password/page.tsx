import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import AuthCaptchaProvider from "@/components/AuthCaptchaProvider";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Lupa password — ${BRAND.name}`,
  description: `Atur ulang password akun ${BRAND.shortName}.`,
  robots: { index: false, follow: false },
};

/*
 * WAJIB force-dynamic - `<ForgotPasswordForm />` dan `<AuthCaptchaProvider />`
 * keduanya client. CSP production memakai nonce per-request (lihat
 * `src/lib/csp.ts`); HTML yang di-prerender tidak punya nonce sehingga browser
 * menolak semua script, dan form plus CAPTCHA tidak akan pernah berfungsi.
 * Penjelasan lengkap di `src/app/admin/page.tsx`.
 */
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <SiteHeader className="auth-header">
        <BrandLogo href="/" size="md" variant="horizontal" />
      </SiteHeader>

      <section className="auth-shell auth-shell-narrow shell">
        <AuthCaptchaProvider>
        <ForgotPasswordForm />
      </AuthCaptchaProvider>
      </section>
    </main>
  );
}