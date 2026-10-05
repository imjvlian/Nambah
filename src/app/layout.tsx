import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ChatWidget from "@/components/ChatWidget";
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

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      "https://nambah.vercel.app",
  ),
  title: "Nambah — Top Up Cepat, Main Lagi",
  description:
    "Top up game dan voucher digital dengan proses simpel dan transparan.",
  applicationName: "Nambah",
  keywords: ["top up game", "voucher digital", "pulsa", "Nambah"],
  openGraph: {
    type: "website",
    siteName: "Nambah",
    title: "Nambah — Top Up Cepat, Main Lagi",
    description:
      "Top up game dan voucher digital dengan proses simpel dan transparan.",
    locale: "id_ID",
  },
  twitter: {
    card: "summary",
    title: "Nambah — Top Up Cepat, Main Lagi",
    description:
      "Top up game dan voucher digital dengan proses simpel dan transparan.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={inter.variable}>
      <body>
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
