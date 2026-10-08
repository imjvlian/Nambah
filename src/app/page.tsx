import AccountNav from "@/components/AccountNav";
import CategorizedTopupExperience from "@/components/CategorizedTopupExperience";
import FlashSaleStrip from "@/components/FlashSaleStrip";
import PromoBannerCarousel from "@/components/PromoBannerCarousel";
import PromoPopup from "@/components/PromoPopup";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
import { getPublicCatalog } from "@/lib/catalog-repository";
import { resolveProductCover } from "@/lib/product-asset-resolver";

export default async function Home() {
  const catalog = await getPublicCatalog();
  const artworkByGameId = Object.fromEntries(
    catalog.games.map((game) => [game.id, resolveProductCover(game)]),
  );

  return (
    <main className="home-v2 home-oura-refine">
      <SiteHeader className="home-v2-header home-market-header">
        <BrandLogo href="#top" size="md" variant="horizontal" />

        <nav className="desktop-nav home-market-nav" aria-label="Navigasi utama">
          <a href="#catalog-start">Top Up</a>
          <a href="#popular">Populer</a>
          <a href="#how-it-works">Cara Kerja</a>
        </nav>

        <div className="header-actions">
          <AccountNav showPoints />
          <a className="header-cta" href="#catalog-start">Mulai top up</a>
        </div>
      </SiteHeader>

      <section id="top" aria-label="Sorotan utama">
        <h1 className="sr-only">Top up cepat. Lanjut main.</h1>
        <PromoBannerCarousel />
      </section>
      <PromoPopup />
      <FlashSaleStrip />

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

      <SiteFooter />
    </main>
  );
}
