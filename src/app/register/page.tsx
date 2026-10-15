import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";
import { optionalSafeNext } from "@/lib/next-path";

export const metadata: Metadata = {
  title: `Daftar — ${BRAND.name}`,
  description: `Buat akun ${BRAND.shortName}.`,
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
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
          <h2>Buat akun. Top up tetap simpel.</h2>
          <p>
            Akun tidak wajib untuk checkout, tetapi membuat transaksi lebih mudah ditemukan kembali.
          </p>
          <div className="trust-list">
            <span><b>01</b> Gratis</span>
            <span><b>02</b> Riwayat tersimpan</span>
            <span><b>03</b> Akses order lebih mudah</span>
          </div>
        </aside>
        <AuthForm mode="register" nextPath={optionalSafeNext(params.next)} />
      </section>
    </main>
  );
}
