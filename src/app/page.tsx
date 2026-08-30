import TopupExperience from "@/components/TopupExperience";
import { getPublicCatalog } from "@/lib/catalog-repository";

export default async function Home() {
  const catalog = await getPublicCatalog();

  return (
    <main>
      <header className="site-header shell">
        <a className="brand" href="#top">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>
        <nav className="desktop-nav" aria-label="Navigasi utama">
          <a href="#games">Produk</a>
          <a href="#topup">Top Up</a>
          <a href="#how-it-works">Cara Kerja</a>
        </nav>
        <a className="header-cta" href="#topup">Mulai top up</a>
      </header>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <span className="eyebrow">Top up digital, dibikin simpel</span>
          <h1>Nambah dikit,<br /><em>lanjut main.</em></h1>
          <p>
            Game, voucher, dan kebutuhan digital dalam satu tempat. Cepat dipilih, jelas dibayar, gampang dilacak.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#games">Pilih game <span>↓</span></a>
            <a className="text-link" href="#how-it-works">Lihat cara kerja</a>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="hero-ticket">
            <div className="ticket-top">
              <span>Nambah</span>
              <span>TOP UP</span>
            </div>
            <div className="ticket-main">
              <small>STATUS</small>
              <strong>SIAP<br />MAIN.</strong>
            </div>
            <div className="ticket-bottom">
              <span>FAST</span>
              <span>•</span>
              <span>SIMPLE</span>
              <span>•</span>
              <span>TRACKED</span>
            </div>
          </div>
          <div className="floating-chip chip-one">QRIS</div>
          <div className="floating-chip chip-two">24/7</div>
        </div>
      </section>

      <div className="shell">
        <TopupExperience
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
            <p>Cari game atau voucher yang kamu butuhkan.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Isi data</h3>
            <p>Masukkan ID akun dan pilih nominal top up.</p>
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
