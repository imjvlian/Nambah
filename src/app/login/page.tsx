import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import AuthCaptchaProvider from "@/components/AuthCaptchaProvider";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";
import { optionalSafeNext } from "@/lib/next-path";

export const metadata: Metadata = {
  title: `Masuk — ${BRAND.name}`,
  description: `Masuk ke akun ${BRAND.shortName}.`,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirmed?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page">
      <SiteHeader className="auth-header">
        <BrandLogo href="/" size="md" variant="horizontal" />
      </SiteHeader>

      <section className="auth-shell shell">
        <aside className="auth-intro">
          <span className="eyebrow">{BRAND.shortName} account</span>
          <h2>Satu akun untuk semua transaksi.</h2>
          <p>
            Riwayat pembayaran dan status pesanan tersimpan di akunmu tanpa mengubah flow top up.
          </p>
          <div className="trust-list">
            <span><b>01</b> Riwayat transaksi</span>
            <span><b>02</b> Status pesanan</span>
            <span><b>03</b> Checkout tanpa akun tetap tersedia</span>
          </div>
        </aside>
        <AuthCaptchaProvider>
          <AuthForm
            mode="login"
            nextPath={optionalSafeNext(params.next)}
            confirmed={params.confirmed === "1"}
            oauthError={params.error}
          />
        </AuthCaptchaProvider>
      </section>
    </main>
  );
}
