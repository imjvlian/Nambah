import CategorizedTopupExperience from "@/components/CategorizedTopupExperience";
import { getPublicCatalog } from "@/lib/catalog-repository";

export default async function Home() {
  const catalog = await getPublicCatalog();

  return (
    <main className="home-v2">
      <header className="site-header shell home-v2-header">
        <a className="brand" href="#top">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>
        <nav className="desktop-nav" aria-label="Navigasi utama">
          <a href="#catalog-start">Produk</a>
          <a href="#topup">Top Up</a>
          <a href="#how-it-works">Cara Kerja</a>
        </nav>
        <a className="header-cta" href="#catalog-start">Cari produk</a>
      </header>

      <section className="hero shell home-v2-hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">Top up digital, lebih cepat</span>
          <h1>Nambah.<br /><em>Lanjut main.</em></h1>
          <p>
            Game, pulsa, e-wallet, voucher, dan kebutuhan digital dalam satu tempat. Pilih produk, bayar, lalu lanjut.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#catalog-start">Cari produk <span>↓</span></a>
            <a className="text-link" href="#how-it-works">Cara kerja</a>
          </div>
        </div>

        <aside className="home-v2-hero-card" aria-label="Ringkasan layanan Nambah">
          <span className="home-v2-hero-card-kicker">Nambah</span>
          <strong>Top up tanpa muter-muter.</strong>
          <p>Produk digital yang kamu butuhkan, dalam flow yang singkat dan jelas.</p>
          <div className="home-v2-hero-card-tags">
            <span>Game</span>
            <span>Pulsa</span>
            <span>E-Wallet</span>
            <span>Voucher</span>
          </div>
          <div className="home-v2-hero-card-meta">
            <span>QRIS</span>
            <span>24/7</span>
            <span>Tracked</span>
          </div>
        </aside>
      </section>

      <div className="shell">
        <CategorizedTopupExperience
          games={catalog.games}
          paymentMethods={catalog.paymentMethods}
          catalogSource={catalog.source}
        />
      </div>

      <section className="how-section shell" id="how-it-works">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Cara kerja</span>
            <h2>Tiga langkah. Selesai.</h2>
          </div>
        </div>
        <div className="how-grid">
          <article>
            <span>01</span>
            <h3>Pilih produk</h3>
            <p>Cari game, pulsa, voucher, atau produk digital yang kamu butuhkan.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Isi data</h3>
            <p>Masukkan data tujuan dan pilih nominal yang tersedia.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Bayar & beres</h3>
            <p>Pembayaran terkonfirmasi, transaksi diproses otomatis.</p>
          </article>
        </div>
      </section>

      <footer className="site-footer shell">
        <a className="brand" href="#top">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>
        <p>Top up cepat. Main lagi.</p>
        <span>© 2026 Nambah.</span>
      </footer>
    </main>
  );
}
