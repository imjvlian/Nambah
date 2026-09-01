import { notFound } from "next/navigation";
import TopupExperience from "@/components/TopupExperience";
import { getPublicCatalog } from "@/lib/catalog-repository";
import type { Game } from "@/lib/catalog";
import {
  resolveProductAsset,
  resolveProductCover,
} from "@/lib/product-asset-resolver";

function searchableProductText(game: Game) {
  return [
    game.name,
    game.shortName,
    ...game.packages.flatMap((item) => [item.label, item.note ?? ""]),
  ]
    .join(" ")
    .toLowerCase();
}

function categoryLabel(game: Game) {
  const text = searchableProductText(game);
  if (game.category === "game" || /(diamond|uc\b|robux|genesis|mobile legends|free fire|pubg|valorant|genshin|honor of kings)/i.test(text)) return "Games";
  if (/(pulsa|paket data|kuota|telkomsel|axis|xl\b|indosat|im3|tri\b|smartfren)/i.test(text)) return "Pulsa & Data";
  if (/(dana\b|ovo\b|gopay|shopeepay|linkaja|e-wallet|e-money)/i.test(text)) return "E-Wallet";
  if (/(pln|token listrik)/i.test(text)) return "PLN";
  if (/(netflix|spotify|vidio|youtube premium|subscription|langganan|canva|capcut)/i.test(text)) return "Langganan";
  return "Voucher & Digital";
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getPublicCatalog();
  const productId = decodeURIComponent(id);
  const game = catalog.games.find((item) => item.id === productId);

  if (!game) notFound();

  const category = categoryLabel(game);
  const productArtwork = resolveProductCover(game);
  const artworkByGameId = { [game.id]: productArtwork };
  const artworkByPackageId = Object.fromEntries(
    game.packages.map((item) => [item.id, resolveProductAsset(game, item)]),
  );

  return (
    <main className="product-page">
      <header className="site-header shell product-site-header">
        <a className="brand" href="/" aria-label="Nambah">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>
        <nav className="desktop-nav" aria-label="Navigasi produk">
          <a href="/">Katalog</a>
          <a href="#transaction">Transaksi</a>
          <a href="#description">Keterangan</a>
        </nav>
        <a className="header-cta" href="#transaction">Top up sekarang</a>
      </header>

      <section className="shell product-hero">
        <div
          className="product-hero-art app-artwork"
          style={{ background: game.accent, overflow: "hidden" }}
        >
          {productArtwork ? (
            <img
              src={productArtwork.src}
              alt={productArtwork.alt}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            game.initials
          )}
        </div>
        <div className="product-hero-copy">
          <a className="product-back-link" href="/">← Kembali ke katalog</a>
          <span className="eyebrow">{category}</span>
          <h1>{game.name}</h1>
          <p>{game.shortName} · Top up melalui Nambah dengan alur transaksi yang singkat dan jelas.</p>
          <div className="product-trust-row" aria-label="Keunggulan transaksi">
            <span><b>01</b> Proses cepat</span>
            <span><b>02</b> Tersedia 24/7</span>
            <span><b>03</b> Pembayaran aman</span>
          </div>
        </div>
      </section>

      <div className="product-tab-wrap">
        <nav className="shell product-tabs" aria-label="Navigasi halaman produk">
          <a className="active" href="#transaction">Transaksi</a>
          <a href="#description">Keterangan</a>
        </nav>
      </div>

      <section className="shell product-transaction" id="transaction">
        <div className="product-flow-heading">
          <div>
            <span className="eyebrow">Top up</span>
            <h2>Selesaikan transaksi.</h2>
          </div>
          <p>Isi data tujuan, pilih nominal, tentukan pembayaran, lalu cek total sebelum lanjut.</p>
        </div>

        <TopupExperience
          games={[game]}
          paymentMethods={catalog.paymentMethods}
          catalogSource={catalog.source}
          artworkByGameId={artworkByGameId}
          artworkByPackageId={artworkByPackageId}
        />
      </section>

      <section className="shell product-description" id="description">
        <div className="product-description-main">
          <span className="eyebrow">Keterangan</span>
          <h2>Top up {game.name}</h2>
          <p>
            Pilih nominal yang tersedia, masukkan data akun atau tujuan dengan benar, lalu lanjutkan ke pembayaran. Harga final tetap divalidasi oleh Nambah sebelum order dibuat.
          </p>
        </div>

        <div className="product-how-grid">
          <article><span>01</span><strong>Masukkan data</strong><p>Isi ID akun dan Server / Zone bila produk membutuhkannya.</p></article>
          <article><span>02</span><strong>Pilih nominal</strong><p>Pilih paket sesuai kebutuhan dan cek harga yang tampil.</p></article>
          <article><span>03</span><strong>Pilih pembayaran</strong><p>Tentukan metode pembayaran yang tersedia untuk transaksi.</p></article>
          <article><span>04</span><strong>Bayar & pantau</strong><p>Selesaikan pembayaran lalu pantau status order dari halaman transaksi.</p></article>
        </div>
      </section>

      <section className="shell product-faq" aria-label="Pertanyaan umum">
        <div>
          <span className="eyebrow">Bantuan</span>
          <h2>Yang perlu kamu tahu.</h2>
        </div>
        <div className="product-faq-list">
          <details>
            <summary>Data akun apa yang harus diisi?</summary>
            <p>Ikuti field yang tampil pada form. Untuk game tertentu Nambah meminta User ID dan Server / Zone ID.</p>
          </details>
          <details>
            <summary>Kapan harga final ditentukan?</summary>
            <p>Harga dihitung ulang oleh backend saat pilihan produk, promo, referral, dan metode pembayaran berubah.</p>
          </details>
          <details>
            <summary>Bagaimana mengecek status transaksi?</summary>
            <p>Setelah pembayaran dibuat, Nambah mengarahkan kamu ke halaman order untuk melihat status pembayaran dan proses transaksi.</p>
          </details>
        </div>
      </section>

      <footer className="site-footer shell product-footer">
        <a className="brand" href="/">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </a>
        <p>Top up cepat. Lanjut main.</p>
        <span>© 2026 Nambah.</span>
      </footer>
    </main>
  );
}
