import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Daftar — Nambah",
  description: "Buat akun Nambah.",
};

function safeNext(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page">
      <header className="site-header shell auth-header">
        <a className="brand" href="/">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>
        <a className="text-link" href="/">Kembali ke beranda</a>
      </header>

      <section className="auth-shell shell">
        <aside className="auth-intro">
          <span className="eyebrow">Nambah account</span>
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
        <AuthForm mode="register" nextPath={safeNext(params.next)} />
      </section>
    </main>
  );
}
