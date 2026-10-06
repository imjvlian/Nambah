import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Kebijakan Privasi — Nambah",
  description:
    "Bagaimana Nambah mengumpulkan, menggunakan, dan melindungi data pribadi kamu.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Dokumen legal"
      title="Kebijakan Privasi"
      updated="6 Oktober 2026"
    >
      <section>
        <p>
          Kebijakan Privasi ini menjelaskan bagaimana Nambah (&ldquo;kami&rdquo;)
          mengumpulkan, menggunakan, menyimpan, dan melindungi data pribadi kamu
          saat menggunakan layanan top up digital di situs Nambah. Dengan
          menggunakan layanan kami, kamu menyetujui praktik yang dijelaskan di
          dokumen ini.
        </p>
      </section>

      <section>
        <h2>1. Data yang kami kumpulkan</h2>
        <ul>
          <li>
            <strong>Data akun</strong>: alamat email saat kamu mendaftar dan login.
          </li>
          <li>
            <strong>Data profil</strong>: nama tampilan dan nomor WhatsApp yang
            kamu isi secara sukarela untuk keperluan pengiriman struk.
          </li>
          <li>
            <strong>Data transaksi</strong>: ID game/akun tujuan, produk yang
            dibeli, nominal, metode pembayaran, status, dan waktu transaksi.
          </li>
          <li>
            <strong>Data interaksi</strong>: percakapan dengan asisten CS digital
            (chatbot) untuk keperluan layanan pelanggan.
          </li>
          <li>
            <strong>Data teknis</strong>: alamat IP dan informasi perangkat/browser
            dalam batas yang diperlukan untuk keamanan dan pencegahan penyalahgunaan.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Bagaimana kami menggunakan data</h2>
        <ul>
          <li>Memproses dan mengirimkan pesanan kamu.</li>
          <li>Memverifikasi pembayaran dan mengirim bukti transaksi (struk).</li>
          <li>Memberikan layanan pelanggan, termasuk melalui asisten digital.</li>
          <li>Mengelola program poin, promo, dan komisi referral/affiliate.</li>
          <li>Mencegah penipuan, penyalahgunaan, dan aktivitas melanggar hukum.</li>
          <li>Memenuhi kewajiban hukum dan pencatatan keuangan.</li>
        </ul>
      </section>

      <section>
        <h2>3. Berbagi data dengan pihak ketiga</h2>
        <p>
          Kami tidak menjual data pribadi kamu. Data hanya dibagikan sebatas yang
          diperlukan untuk menjalankan layanan:
        </p>
        <ul>
          <li>
            <strong>Penyedia pembayaran</strong> — untuk memproses transaksi
            pembayaran kamu secara aman.
          </li>
          <li>
            <strong>Penyedia produk digital</strong> — ID game/akun tujuan
            diteruskan untuk pengiriman produk yang kamu beli.
          </li>
          <li>
            <strong>Penyedia infrastruktur</strong> — hosting, basis data, email,
            dan notifikasi yang memproses data atas instruksi kami.
          </li>
          <li>
            <strong>Otoritas hukum</strong> — bila diwajibkan oleh peraturan yang
            berlaku.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Keamanan data</h2>
        <p>
          Kami menerapkan langkah teknis dan organisasi yang wajar: koneksi
          terenkripsi (HTTPS), pembatasan akses berbasis peran, serta pemisahan
          kredensial server dari sisi publik. Tidak ada sistem yang 100% aman,
          namun kami terus meninjau dan memperbaiki perlindungan kami.
        </p>
      </section>

      <section>
        <h2>5. Penyimpanan data</h2>
        <p>
          Data transaksi disimpan selama diperlukan untuk operasional, pencatatan
          keuangan, dan kewajiban hukum. Data profil disimpan selama akun kamu
          aktif. Kamu dapat meminta penghapusan data sesuai bagian Hak Pengguna.
        </p>
      </section>

      <section>
        <h2>6. Cookie</h2>
        <p>
          Kami menggunakan cookie sesi yang diperlukan untuk login dan keamanan
          akun (cookie esensial). Kami tidak menggunakan cookie pelacak iklan
          pihak ketiga.
        </p>
      </section>

      <section>
        <h2>7. Hak kamu</h2>
        <ul>
          <li>Mengakses dan memperbarui data profil kamu melalui halaman akun.</li>
          <li>Meminta salinan data pribadi yang kami simpan.</li>
          <li>Meminta penghapusan akun dan data terkait, sepanjang tidak
            bertentangan dengan kewajiban pencatatan hukum.</li>
          <li>Menarik persetujuan pengiriman struk/notifikasi melalui pengaturan
            di halaman akun.</li>
        </ul>
      </section>

      <section>
        <h2>8. Perubahan kebijakan</h2>
        <p>
          Kebijakan ini dapat diperbarui dari waktu ke waktu. Perubahan material
          akan diumumkan melalui situs. Tanggal pembaruan terakhir selalu
          tercantum di bagian atas halaman ini.
        </p>
      </section>

      <section>
        <h2>9. Kontak</h2>
        <div className="legal-contact-box">
          <p>
            Untuk pertanyaan seputar privasi dan data pribadi, hubungi kami
            melalui halaman akun atau kanal dukungan yang tersedia di situs,
            dengan menyertakan alamat email akun kamu.
          </p>
        </div>
      </section>
    </LegalShell>
  );
}
