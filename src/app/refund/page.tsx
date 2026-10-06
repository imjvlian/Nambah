import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Kebijakan Pengembalian Dana — Nambah",
  description:
    "Ketentuan pengembalian dana (refund) untuk transaksi di Nambah.",
};

export default function RefundPage() {
  return (
    <LegalShell
      eyebrow="Dokumen legal"
      title="Kebijakan Pengembalian Dana"
      updated="6 Oktober 2026"
    >
      <section>
        <p>
          Kebijakan ini menjelaskan kapan dana kamu dapat dikembalikan dan
          bagaimana prosesnya. Dokumen ini merupakan bagian dari{" "}
          <a href="/terms">Ketentuan Layanan</a> Nambah.
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
          <li>Pesanan yang sudah berstatus berhasil (produk sudah terkirim).</li>
          <li>Pesanan yang kamu batalkan sendiri atau kedaluwarsa sebelum
            pembayaran dilakukan (tidak ada dana yang terpotong).</li>
          <li>Akibat pemblokiran/pembekuan akun game oleh penerbit game di luar
            kendali kami.</li>
        </ul>
      </section>

      <section>
        <h2>3. Cara mengajukan</h2>
        <ul>
          <li>Hubungi dukungan pelanggan melalui kanal yang tersedia di situs
            dengan menyertakan <strong>nomor order</strong> (format NBH-…).</li>
          <li>Sertakan bukti pembayaran bila diminta.</li>
          <li>Tim kami memverifikasi status pesanan dan pembayaran terlebih
            dahulu sebelum refund diproses.</li>
        </ul>
      </section>

      <section>
        <h2>4. Waktu dan metode pengembalian</h2>
        <ul>
          <li>Refund diproses maksimal <strong>3×24 jam kerja</strong> setelah
            pengajuan disetujui.</li>
          <li>Dana dikembalikan ke metode/sumber pembayaran yang sama bila
            didukung penyedia pembayaran; alternatifnya melalui transfer ke
            rekening/e-wallet yang kamu berikan.</li>
          <li>Biaya layanan pembayaran yang sudah terjadi dapat dipotong dari
            nilai refund sesuai kebijakan penyedia pembayaran.</li>
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
            Pengajuan refund dan pertanyaan statusnya dapat dilakukan melalui
            halaman akun atau kanal dukungan yang tersedia di situs. Sertakan
            selalu nomor order agar proses verifikasi berjalan cepat.
          </p>
        </div>
      </section>
    </LegalShell>
  );
}
