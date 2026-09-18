import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Masuk — Nambah",
  description: "Masuk ke akun Nambah.",
};

function safeNext(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirmed?: string }>;
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
          <h2>Satu akun untuk semua transaksi.</h2>
          <p>
            Riwayat pembayaran dan status pesanan tersimpan di akunmu tanpa mengubah flow top up.
          </p>
          <div className="trust-list">
            <span><b>01</b> Riwayat transaksi</span>
            <span><b>02</b> Status pesanan</span>
            <span><b>03</b> Guest checkout tetap tersedia</span>
          </div>
        </aside>
        <AuthForm
          mode="login"
          nextPath={safeNext(params.next)}
          confirmed={params.confirmed === "1"}
        />
      </section>
    </main>
  );
}
