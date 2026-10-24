import type { Metadata } from "next";
import AccountNav from "@/components/AccountNav";
import BrandLogo from "@/components/BrandLogo";
import CopyButton from "@/components/CopyButton";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { BRAND } from "@/lib/brand";
import {
  getActivePromotions,
  type PublicPromotion,
} from "@/lib/public-promotions";
import "./promo.css";

export const metadata: Metadata = {
  title: `Promo Aktif — ${BRAND.name}`,
  description:
    `Semua kode promo yang sedang berjalan di ${BRAND.shortName}: tinggal salin, tempel di checkout, dan potongannya langsung terlihat.`,
};

/*
 * WAJIB force-dynamic — root layout memuat komponen client (ChatWidget)
 * dan CSP production memakai nonce per-request. Tanpa ini HTML di-prerender
 * tanpa nonce dan browser menolak script. Penjelasan lengkap di
 * `src/app/admin/page.tsx`. Bonus di halaman ini: daftar promo harus
 * mengikuti jendela waktu (mulai/berakhir) — cache statis bisa menampilkan
 * promo yang sudah kedaluwarsa.
 */
export const dynamic = "force-dynamic";

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(date);
}

function PromoCard({ promo }: { promo: PublicPromotion }) {
  const exhausted = promo.remainingQuota === 0;

  return (
    <article className={"promo-card" + (exhausted ? " promo-card-exhausted" : "")}>
      <div className="promo-card-head">
        <div>
          <span className="eyebrow">{promo.name}</span>
          <strong className="promo-benefit">{promo.benefitText}</strong>
        </div>
        <div className="promo-code-block">
          <code>{promo.code}</code>
          <CopyButton value={promo.code} label="Salin kode" copiedLabel="Tersalin" />
        </div>
      </div>

      <ul className="promo-terms">
        {promo.minimumOrder > 0 ? (
          <li>Minimal belanja {IDR.format(promo.minimumOrder)}</li>
        ) : null}
        {promo.endsAt ? <li>Berlaku sampai {formatDate(promo.endsAt)}</li> : null}
        {promo.quotaPerUser && promo.quotaPerUser > 0 ? (
          <li>Maksimal {promo.quotaPerUser}× per akun</li>
        ) : null}
        {promo.productScope.kind === "all" ? (
          <li>Berlaku untuk semua produk</li>
        ) : (
          <li>
            Berlaku untuk produk tertentu
            {promo.productScope.labels.length > 0
              ? ` — ${promo.productScope.labels.join(", ")}${
                  promo.productScope.total > promo.productScope.labels.length
                    ? ` dan ${promo.productScope.total - promo.productScope.labels.length} lainnya`
                    : ""
                }`
              : ""}
          </li>
        )}
        {promo.stackableWithReferral ? (
          <li>Bisa digabung dengan kode referral</li>
        ) : (
          <li>Tidak bisa digabung dengan kode referral</li>
        )}
      </ul>

      {exhausted ? (
        <p className="promo-quota-note">Kuota promo ini sudah habis.</p>
      ) : promo.remainingQuota !== null && promo.remainingQuota <= 20 ? (
        <p className="promo-quota-note">
          Sisa kuota {promo.remainingQuota} — buruan sebelum kehabisan.
        </p>
      ) : null}

      <a className="promo-cta" href="/#topup">
        {exhausted ? "Top up tanpa promo" : "Top up dengan kode ini"} →
      </a>
    </article>
  );
}

export default async function PromoPage() {
  const promotions = await getActivePromotions();

  return (
    <main className="promo-page">
      <SiteHeader className="home-v2-header home-market-header">
        <BrandLogo href="/#top" size="md" variant="horizontal" />
        <div className="header-actions">
          <AccountNav />
        </div>
      </SiteHeader>

      <section className="shell promo-hero">
        <span className="eyebrow">Promo</span>
        <h1>Promo yang sedang jalan.</h1>
        <p>
          Salin kodenya, tempel di kolom promo saat checkout, dan potongannya
          langsung kelihatan di total. Semua kode di bawah ini sedang aktif
          untuk dipakai sekarang.
        </p>
      </section>

      <section className="shell promo-list" aria-label="Daftar promo aktif">
        {promotions.length === 0 ? (
          <div className="promo-empty">
            <strong>Belum ada promo yang sedang berjalan.</strong>
            <p>
              Cek lagi nanti — promo baru biasanya muncul menjelang tanggal
              merah dan event besar.
            </p>
            <a className="promo-cta" href="/#topup">
              Top up seperti biasa →
            </a>
          </div>
        ) : (
          promotions.map((promo) => (
            <PromoCard key={promo.code} promo={promo} />
          ))
        )}
      </section>

      <SiteFooter />
    </main>
  );
}
