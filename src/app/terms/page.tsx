import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Ketentuan Layanan — Nambah",
  description:
    "Syarat dan ketentuan penggunaan layanan top up digital Nambah.",
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Dokumen legal"
      title="Ketentuan Layanan"
      updated="6 Oktober 2026"
    >
      <section>
        <p>
          Ketentuan Layanan ini mengatur penggunaan situs dan layanan Nambah
          (&ldquo;Layanan&rdquo;). Dengan mengakses atau menggunakan Layanan, kamu
          menyatakan telah membaca, memahami, dan menyetujui ketentuan ini.
        </p>
      </section>

      <section>
        <h2>1. Tentang layanan</h2>
        <p>
          Nambah adalah platform penjualan produk digital — termasuk top up
          game, pulsa, paket data, voucher, dan pembayaran tagihan — yang
          diproses secara otomatis setelah pembayaran terkonfirmasi. Produk
          digital dikirimkan oleh penyedia produk pihak ketiga atas pesanan kamu.
        </p>
      </section>

      <section>
        <h2>2. Akun</h2>
        <ul>
          <li>Kamu bertanggung jawab menjaga kerahasiaan akun dan password.</li>
          <li>Informasi akun harus benar dan dapat dihubungi.</li>
          <li>Kami berhak menangguhkan akun yang terindikasi penyalahgunaan,
            penipuan, atau pelanggaran ketentuan ini.</li>
        </ul>
      </section>

      <section>
        <h2>3. Pesanan dan pembayaran</h2>
        <ul>
          <li>Harga dan ketersediaan produk dapat berubah sewaktu-waktu; harga
            yang berlaku adalah yang tampil saat checkout dan divalidasi ulang
            di sisi server.</li>
          <li>Pesanan dibuat setelah kamu menyelesaikan proses checkout dan
            memiliki batas waktu pembayaran. Pesanan yang melewati batas waktu
            dibatalkan otomatis.</li>
          <li>Pembayaran diverifikasi otomatis oleh penyedia pembayaran. Pesanan
            mulai diproses setelah pembayaran terkonfirmasi lunas.</li>
        </ul>
      </section>

      <section>
        <h2>4. Keakuratan data tujuan</h2>
        <p>
          Kamu bertanggung jawab penuh atas kebenaran ID akun/nomor tujuan yang
          dimasukkan. <strong>Produk yang terkirim ke ID yang salah karena
          kesalahan penginputan oleh kamu tidak dapat ditarik kembali dan tidak
          dapat di-refund</strong>, karena produk digital bersifat final setelah
          terkirim. Sistem kami menyediakan validasi format dan (untuk sebagian
          produk) pengecekan nama akun untuk membantu meminimalkan kesalahan.
        </p>
      </section>

      <section>
        <h2>5. Waktu proses</h2>
        <p>
          Sebagian besar pesanan selesai dalam hitungan menit setelah pembayaran
          terkonfirmasi. Pada kondisi tertentu (gangguan penyedia produk, antrian,
          atau pemeliharaan), proses dapat memakan waktu lebih lama. Status setiap
          pesanan dapat dipantau secara transparan di halaman pesanan.
        </p>
      </section>

      <section>
        <h2>6. Pengembalian dana</h2>
        <p>
          Ketentuan pengembalian dana diatur secara terpisah dalam{" "}
          <a href="/refund">Kebijakan Pengembalian Dana</a> dan merupakan bagian
          yang tidak terpisahkan dari Ketentuan Layanan ini.
        </p>
      </section>

      <section>
        <h2>7. Promo, poin, dan referral</h2>
        <ul>
          <li>Kode promo dan kode referral tunduk pada syarat masing-masing
            kampanye (kuota, periode, minimum transaksi, batas per akun).</li>
          <li>Penyalahgunaan promo (multi-akun, manipulasi, kecurangan) dapat
            mengakibatkan pembatalan benefit dan penangguhan akun.</li>
          <li>Poin dan komisi tidak dapat diuangkan di luar mekanisme resmi yang
            kami sediakan.</li>
        </ul>
      </section>

      <section>
        <h2>8. Larangan penggunaan</h2>
        <ul>
          <li>Aktivitas penipuan, pencucian uang, atau pelanggaran hukum.</li>
          <li>Mengganggu, membobol, atau membebani sistem secara tidak wajar.</li>
          <li>Menyalahgunakan celah harga, promo, atau sistem referral.</li>
          <li>Menjual kembali akses akun Nambah kamu kepada pihak lain.</li>
        </ul>
      </section>

      <section>
        <h2>9. Batasan tanggung jawab</h2>
        <p>
          Layanan disediakan &ldquo;sebagaimana adanya&rdquo;. Sejauh diizinkan
          hukum, tanggung jawab kami atas suatu pesanan dibatasi maksimal sebesar
          nilai transaksi pesanan tersebut. Kami tidak bertanggung jawab atas
          kerugian tidak langsung, kehilangan keuntungan, atau gangguan di luar
          kendali wajar kami (termasuk gangguan penyedia produk pihak ketiga).
        </p>
      </section>

      <section>
        <h2>10. Perubahan ketentuan</h2>
        <p>
          Ketentuan ini dapat diperbarui dari waktu ke waktu. Penggunaan Layanan
          setelah perubahan berlaku dianggap sebagai persetujuan atas versi
          terbaru.
        </p>
      </section>

      <section>
        <h2>11. Hukum yang berlaku</h2>
        <p>
          Ketentuan Layanan ini tunduk pada hukum Republik Indonesia. Sengketa
          akan diupayakan diselesaikan secara musyawarah terlebih dahulu.
        </p>
      </section>
    </LegalShell>
  );
}
