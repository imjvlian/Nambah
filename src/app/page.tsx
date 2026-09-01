import CategorizedTopupExperience from "@/components/CategorizedTopupExperience";
import { getPublicCatalog } from "@/lib/catalog-repository";
import { resolveProductCover } from "@/lib/product-asset-resolver";

export default async function Home() {
  const catalog = await getPublicCatalog();
  const artworkByGameId = Object.fromEntries(
    catalog.games.map((game) => [game.id, resolveProductCover(game)]),
  );

  return (
    <main className="home-v2 home-oura-refine">
      <header className="site-header shell home-v2-header home-market-header">
        <a className="brand" href="#top" aria-label="Nambah">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>

        <nav className="desktop-nav home-market-nav" aria-label="Navigasi utama">
          <a href="#catalog-start">Top Up</a>
          <a href="#popular">Populer</a>
          <a href="#how-it-works">Cara Kerja</a>
        </nav>

        <a className="header-cta" href="#catalog-start">Mulai top up</a>
      </header>

      <section className="hero shell home-v2-hero home-market-hero" id="top">
        <div className="hero-copy home-market-copy">
          <span className="eyebrow">Top up digital · 24/7</span>
          <h1>Top up cepat.<br /><em>Lanjut main.</em></h1>
          <p>
            Pilih game atau kebutuhan digitalmu, bayar dengan cara yang simpel, lalu pantau prosesnya dengan jelas.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#catalog-start">Top up sekarang <span>↓</span></a>
            <a className="text-link" href="#how-it-works">Cara kerja</a>
          </div>
        </div>

        <aside className="home-market-board" aria-label="Layanan Nambah">
          <div className="home-market-board-head">
            <span className="home-market-board-mark">N+</span>
            <span className="home-market-live"><i /> ONLINE</span>
          </div>
          <div className="home-market-board-copy">
            <small>SEMUA DALAM SATU FLOW</small>
            <strong>Pilih.<br />Bayar.<br /><em>Beres.</em></strong>
          </div>
          <div className="home-market-board-meta">
            <span><b>QRIS</b><small>Pembayaran simpel</small></span>
            <span><b>24/7</b><small>Katalog selalu siap</small></span>
            <span><b>TRACKED</b><small>Status lebih jelas</small></span>
          </div>
        </aside>
      </section>

      <section className="shell home-trust-strip" aria-label="Keunggulan layanan">
        <article>
          <span>01</span>
          <div><strong>Proses cepat</strong><small>Flow top up dibuat sesingkat mungkin.</small></div>
        </article>
        <article>
          <span>02</span>
          <div><strong>Tersedia 24/7</strong><small>Pilih produk kapan pun kamu butuh.</small></div>
        </article>
        <article>
          <span>03</span>
          <div><strong>Pembayaran aman</strong><small>Harga divalidasi sebelum checkout.</small></div>
        </article>
        <article>
          <span>04</span>
          <div><strong>Status terlacak</strong><small>Proses transaksi tetap transparan.</small></div>
        </article>
      </section>

      <div className="shell">
        <CategorizedTopupExperience
          games={catalog.games}
          artworkByGameId={artworkByGameId}
        />
      </div>

      <section className="how-section shell home-how-section" id="how-it-works">
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
            <p>Masukkan data tujuan lalu pilih nominal yang tersedia.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Bayar & beres</h3>
            <p>Pembayaran terkonfirmasi lalu transaksi diproses secara otomatis.</p>
          </article>
        </div>
      </section>

      <footer className="site-footer shell home-market-footer">
        <a className="brand" href="#top">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>
        <p>Top up cepat. Lanjut main.</p>
        <span>© 2026 Nambah.</span>
      </footer>
    </main>
  );
}
