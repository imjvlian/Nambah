export default function SiteFooter() {
  return (
    <footer className="site-footer shell">
      <div className="footer-grid">
        <div className="footer-brand">
          <a className="brand" href="/#top" aria-label="Nambah">
            <span className="brand-mark"><img src="/logo/nambah-logo.svg" alt="" /></span>
            <span>Nambah</span>
          </a>
          <p>Top up cepat. Lanjut main.</p>
          <div className="footer-chips" aria-label="Keunggulan layanan">
            <span>24/7</span>
            <span>QRIS ready</span>
            <span>Status terlacak</span>
          </div>
        </div>

        <nav className="footer-col" aria-label="Jelajahi">
          <small>Jelajahi</small>
          <a href="/#catalog-start">Top up</a>
          <a href="/#popular">Populer</a>
          <a href="/#how-it-works">Cara kerja</a>
        </nav>

        <nav className="footer-col" aria-label="Akun">
          <small>Akun</small>
          <a href="/login">Masuk</a>
          <a href="/register">Daftar</a>
          <a href="/account">Akun saya</a>
        </nav>

        <nav className="footer-col" aria-label="Dokumen legal">
          <small>Legal</small>
          <a href="/privacy">Kebijakan Privasi</a>
          <a href="/terms">Ketentuan Layanan</a>
          <a href="/refund">Pengembalian Dana</a>
        </nav>
      </div>

      <div className="footer-bottom">
        <span>© 2026 Nambah. Seluruh hak cipta dilindungi.</span>
        <span className="footer-bottom-note">Produk digital diproses otomatis setelah pembayaran terkonfirmasi.</span>
      </div>
    </footer>
  );
}
