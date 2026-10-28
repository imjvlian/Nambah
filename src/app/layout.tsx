import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import AdSenseScript from "@/components/AdSenseScript";
import ChatWidget from "@/components/ChatWidget";
import { BRAND, siteUrl } from "@/lib/brand";
import "./globals.css";
import "./catalog-categories.css";
import "./home-v2.css";
import "./product-v2.css";
import "./pricing.css";
import "./product-checkout-v2.css";
import "./product-grouped-nominals.css";
import "./account-auto-check.css";
import "./order.css";
import "./admin.css";
import "./admin-control-center.css";
import "./admin-automation.css";
import "./admin-source-of-truth.css";
import "./midtrans.css";
import "./admin-digiflazz.css";
import "./admin-digiflazz-v2.css";
import "./admin-publish-checkbox.css";
import "./admin-supplier-link.css";
import "./product-checkout-rail-v2.css";
import "./auth.css";
import "./points.css";
import "./promo-banner.css";
import "./legal.css";
import "./reviews.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.description,
  applicationName: BRAND.name,
  keywords: ["top up game", "voucher digital", "pulsa", BRAND.shortName, BRAND.name],
  // `themeColor` TIDAK lagi di sini. Next.js 16 memindahkannya ke export
  // `viewport` - kalau masih di `metadata`, setiap page load penuh
  // menghasilkan warning, dan warninya ikut muncul di halaman merchant yang
  // baru. Lihat `viewport` di bawah.
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: "/icon.svg",
    apple: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    other: [
      {
        rel: "mask-icon",
        url: "/mask-icon.svg",
        color: BRAND.brandColor,
      },
    ],
  },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    locale: "id_ID",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: `${BRAND.name} — ${BRAND.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    images: ["/api/og"],
  },
};

/**
 * `themeColor` pindah ke sini mulai Next.js 16.
 *
 * Nilainya sama persis dengan yang tadinya ada di `metadata` - dipindah,
 * bukan diubah, jadi warna address bar di HP tidak berubah.
 */
export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
};

/**
 * SELURUH APLIKASI WAJIB DIRENDER DINAMIS. Baris ini bukan pilihan gaya -
 * ini syarat agar Content-Security-Policy di `src/lib/csp.ts` berfungsi.
 *
 * MASALAHNYA
 *
 * CSP production memakai nonce BARU setiap request:
 *
 *   script-src 'self' 'nonce-<uuid>' 'strict-dynamic'
 *
 * Noncenya dibuat di `src/middleware.ts` lalu dikirim sebagai header `x-nonce`.
 * Next.js hanya bisa menempelkan nonce itu ke tag <script> SAAT merender
 * permintaan - tidak saat build.
 *
 * Halaman yang di-prerender (`○` di output build) selesai di titik itu:
 * HTML-nya sudah dibakar saat `npm run build`, saat tidak ada request dan
 * tidak ada nonce. Ketika permintaan datang, middleware tetap memasang CSP
 * yang menuntut `nonce-<uuid>`, sementara tag <script> di HTML itu tidak punya
 * nonce sama sekali. Browser menolak SEMUA script.
 *
 * Dan `'strict-dynamic'` menutup jalan keluar: di CSP3 perintah itu
 * mengabaikan `'self'` beserta daftar host, jadi hanya nonce atau hash yang
 * bisa memuat script.
 *
 * GEJALANYA
 *
 * Halaman tetap menampilkan teks hasil SSR, tapi tidak pernah interaktif.
 * Untuk halaman admin itu berarti tersangkut di "Memuat ..." selamanya.
 * Ditemukan di production pada Oktober 2026: seluruh JS di /admin tertandai
 * `(blocked:csp)` di DevTools.
 *
 * KENAPA DI SINI, BUKAN DI SETIAP PAGE
 *
 * `dynamic` diwarisi ke semua segment turunan. Satu baris di root menutup
 * semua halaman yang ada sekarang DAN setiap halaman yang akan ditambahkan
 * nanti - termasuk halaman yang mungkin masih punya bug yang sama tanpa
 * disadari.
 *
 * Halaman yang benar-benar butuh ini tetap declare `force-dynamic` eksplisit
 * di page-nya sendiri (lihat `src/app/admin/page.tsx`) supaya niatnya terlihat
 * saat dibaca, dan supaya menghapus baris di satu tempat tidak diam-diam
 * mematikan kontrol ini.
 *
 * TIDAK berlaku untuk `robots.ts` dan `sitemap.ts` - keduanya route handler,
 * bukan page, jadi tidak pernah memakai layout ini.
 *
 * CATATAN PERFORMA
 *
 * Dynamic bukan berarti lambat. `force-dynamic` mengatur caching HALAMAN,
 * bukan caching DATA. `getPublicCatalog()` tetap bisa di-cache lewat
 * `revalidate` atau `unstable_cache` - datanya di-cache, pertanyaannya tetap
 * dirender per request supaya nonce-nya benar.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`${inter.variable} ${plusJakartaSans.variable}`}>
      <body>
        <AdSenseScript />
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
