import type { Metadata } from "next";
import AccountNav from "@/components/AccountNav";
import BrandLogo from "@/components/BrandLogo";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { BRAND } from "@/lib/brand";
import { DEFAULT_AFFILIATE_RATE } from "@/lib/pricing";
import { getAffiliateTier2Rate } from "@/lib/affiliate-upline";
import { supabaseSelect } from "@/lib/supabase/server";
import "./afiliasi.css";

export const metadata: Metadata = {
  title: `Program Afiliasi — ${BRAND.name}`,
  description:
    `Jadi mitra afiliasi ${BRAND.shortName}: dapat komisi dari setiap top up yang Anda arahkan, plus bonus dari mitra yang Anda rekrut.`,
};

/*
 * WAJIB force-dynamic — root layout memuat komponen client (ChatWidget)
 * dan CSP production memakai nonce per-request. Rate komisi juga dibaca
 * dari app_settings per request, jadi cache statis bisa menampilkan
 * angka yang sudah tidak berlaku.
 */
export const dynamic = "force-dynamic";

/** Minimal pencairan komisi — sumber yang sama dengan panel akun (P1.4). */
async function readMinPayout(): Promise<number> {
  try {
    const [row] = await supabaseSelect<{ value: unknown }>("app_settings", {
      select: "value",
      filters: { key: "eq.affiliate_min_payout" },
      limit: 1,
    });
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  } catch {
    return 10000;
  }
}

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default async function AfiliasiPage() {
  /*
   * Tier-1 "hingga": rate final ditentukan admin saat menyetujui
   * pengajuan (kebijakan yang sama dengan panel pendaftaran — jangan
   * menjanjikan angka pasti di halaman marketing).
   * Tier-2 global dari app_settings — angka live supaya halaman ini
   * tidak berbohong kalau admin mengubahnya.
   */
  const tier2Rate = await getAffiliateTier2Rate();
  const minPayout = await readMinPayout();
  const tier1Percent = Math.round(DEFAULT_AFFILIATE_RATE * 100);
  const tier2Percent = Math.round(tier2Rate * 100);

  return (
    <main className="afiliasi-page">
      <SiteHeader className="home-v2-header home-market-header">
        <BrandLogo href="/#top" size="md" variant="horizontal" />
        <div className="header-actions">
          <AccountNav />
        </div>
      </SiteHeader>

      <section className="shell afiliasi-hero">
        <span className="eyebrow">Program afiliasi</span>
        <h1>Ajak pemain top up, dapat komisi.</h1>
        <p>
          Bagikan link Anda, dan setiap orang yang top up lewat link itu
          menghasilkan komisi untuk Anda. Tanpa modal, tanpa stok — cukup
          audiens yang percaya pada rekomendasi Anda.
        </p>
        <div className="afiliasi-cta-row">
          <a className="primary-button" href="/register">
            Daftar sekarang <span>→</span>
          </a>
          <a className="afiliasi-cta-secondary" href="/login?next=%2Faccount">
            Sudah punya akun? Masuk
          </a>
        </div>
      </section>

      <section className="shell afiliasi-rates" aria-label="Skema komisi">
        <article>
          <small>Komisi Anda</small>
          <strong>hingga {tier1Percent}%</strong>
          <p>
            Dari profit eligible setiap order yang masuk lewat kode atau link
            Anda. Rate final ditetapkan saat pengajuan Anda disetujui.
          </p>
        </article>
        <article>
          <small>Bonus merekrut mitra</small>
          <strong>{tier2Percent}%</strong>
          <p>
            Saat mitra yang Anda arahkan mendapat order, Anda menerima bonus
            dari profit order itu — dibayar oleh toko, bukan dipotong dari
            komisi mitra Anda.
          </p>
        </article>
        <article>
          <small>Pencairan</small>
          <strong>Kapan saja</strong>
          <p>
            Komisi bisa dicairkan setelah melewati masa tunggu 3 hari sejak
            order sukses. Minimal pencairan {IDR.format(minPayout)}.
          </p>
        </article>
      </section>

      <section className="shell afiliasi-steps" aria-label="Cara bergabung">
        <h2>Cara bergabung</h2>
        <ol>
          <li>
            <span>1</span>
            <div>
              <strong>Buat akun {BRAND.shortName}</strong>
              <p>Gratis dan hanya butuh email yang aktif.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Ajukan menjadi mitra</strong>
              <p>
                Buka <em>Akun Saya</em> lalu isi formulir afiliasi: nama
                channel, WhatsApp, dan link channel Anda. Tim kami meninjau
                setiap pengajuan.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Bagikan link Anda</strong>
              <p>
                Setelah disetujui, Anda mendapat kode dan link pribadi. Setiap
                order lewat link itu tercatat sebagai komisi Anda, lengkap
                dengan riwayatnya di dashboard akun.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="shell afiliasi-notes" aria-label="Catatan program">
        <h2>Yang perlu Anda tahu</h2>
        <ul>
          <li>
            Komisi dihitung dari <strong>profit eligible</strong> order —
            selisih harga jual dan modal setelah promo — bukan dari nominal
            yang dibayar pelanggan.
          </li>
          <li>
            Komisi terekam otomatis saat order <strong>sukses</strong>, dan
            batal otomatis kalau order terlanjur di-refund.
          </li>
          <li>
            Kode Anda bisa dipakai pelanggan lewat kolom referral saat
            checkout, atau lewat link Anda yang sudah berisi kodenya.
          </li>
        </ul>
        <a className="primary-button" href="/register">
          Mulai dari akun <span>→</span>
        </a>
      </section>

      <SiteFooter />
    </main>
  );
}
