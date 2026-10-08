import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import ChatWidget from "@/components/ChatWidget";
import { BRAND } from "@/lib/brand";
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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || BRAND.url,
  ),
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.description,
  applicationName: BRAND.name,
  keywords: ["top up game", "voucher digital", "pulsa", "Nambah"],
  themeColor: BRAND.themeColor,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: "/icon.svg",
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`${inter.variable} ${plusJakartaSans.variable}`}>
      <body>
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
