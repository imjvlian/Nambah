import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Kebijakan Pengembalian Dana — ${BRAND.name}`,
  description:
    `Ketentuan pengembalian dana (refund) untuk transaksi di ${BRAND.shortName}.`,
};

export default function RefundPage() {
  return (
    <LegalShell
      eyebrow="Dokumen legal"
      title="Kebijakan Pengembalian Dana"
      updated="17 Oktober 2026"
    >
      <section>
        <p>
          Kebijakan ini menjelaskan kapan dana kamu dapat dikembalikan dan
          bagaimana prosesnya. Dokumen ini merupakan bagian dari{" "}
          <a href="/terms">Ketentuan Layanan</a> {BRAND.shortName}.
        </p>
      </section>

      <section>
        <h2>1. Kondisi yang berhak mendapat refund</h2>
        <ul>
          <li>
            <strong>Pembayaran berhasil, produk gagal terkirim</strong> — misalnya
            karena gangguan pada penyedia produk atau produk tidak tersedia, dan
            pesanan dinyatakan gagal oleh sistem kami.
          </li>
          <li>
            <strong>Pembayaran ganda</strong> untuk satu pesanan yang sama yang
            terverifikasi oleh penyedia pembayaran.
          </li>
          <li>
            <strong>Kesalahan nominal</strong> yang terbukti disebabkan oleh
            kesalahan sistem kami.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Kondisi yang TIDAK dapat di-refund</h2>
        <ul>
          <li>
            Kesalahan penginputan ID akun/nomor tujuan oleh kamu — produk digital
            yang sudah terkirim bersifat final dan tidak dapat ditarik kembali.
          </li>
          <li>
            Pesanan yang sudah berstatus berhasil — <em>kecuali</em> terbukti ada
            kesalahan sistem kami, misalnya nominal atau produk yang terkirim
            tidak sesuai dengan yang kamu bayar.
          </li>
          <li>Pesanan yang kamu batalkan sendiri atau kedaluwarsa sebelum
            pembayaran dilakukan (tidak ada dana yang terpotong).</li>
          <li>Akibat pemblokiran/pembekuan akun game oleh penerbit game di luar
            kendali kami.</li>
        </ul>
      </section>

      <section>
        <h2>3. Cara mengajukan</h2>
        <ul>
          <li>
            Buka <strong>halaman status pesanan</strong> kamu (link ada di email
            atau halaman akun), lalu isi form ajukan refund di kartu ringkasan
            pesanan. Kamu cukup menjelaskan masalahnya — sisanya kami yang
            proses.
          </li>
          <li>
            Alternatifnya, hubungi dukungan pelanggan melalui kanal yang
            tersedia di situs dengan menyertakan{" "}
            <strong>nomor order</strong> (format NBH-…).
          </li>
          <li>
            Tim kami memverifikasi status pesanan dan pembayaran terlebih
            dahulu, lalu memproses pengembalian lewat gateway pembayaran asal
            bila didukung.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Waktu dan metode pengembalian</h2>
        <ul>
          <li>Refund diproses maksimal <strong>3×24 jam kerja</strong> setelah
            pengajuan disetujui.</li>
          <li>
            Dana dikembalikan ke <strong>metode pembayaran yang sama</strong>{" "}
            bila didukung penyedia pembayaran; alternatifnya melalui transfer
            manual ke rekening/e-wallet yang kamu berikan.
          </li>
          <li>
            Untuk refund akibat <strong>kesalahan sistem</strong> kami, biaya
            layanan pembayaran <strong>diserap oleh {BRAND.shortName}</strong>{" "}
            — kamu menerima kembali nominal penuh yang kamu bayar.
          </li>
          <li>
            Points dan komisi afiliasi yang terkait pesanan akan{" "}
            <strong>dikembalikan/dibatalkan</strong> sesuai kondisi semula.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Sengketa transaksi</h2>
        <p>
          Jika kamu merasa ada transaksi yang tidak kamu kenali, segera hubungi
          kami sebelum mengajukan chargeback ke bank. Penyelesaian langsung
          biasanya jauh lebih cepat, dan kami berkomitmen menelusuri setiap
          laporan secara transparan.
        </p>
      </section>

      <section>
        <h2>6. Kontak</h2>
        <div className="legal-contact-box">
          <p>
            Cara tercepat mengajukan refund adalah lewat form di{" "}
            <strong>halaman status pesanan</strong>. Kamu juga bisa mengecek
            status refundnya di halaman yang sama setelah diajukan. Untuk bantuan
            lebih lanjut, hubungi kanal dukungan yang tersedia di situs dan
            sertakan selalu nomor order agar verifikasi berjalan cepat.
          </p>
        </div>
      </section>
    </LegalShell>
  );
}
