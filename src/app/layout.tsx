import type { Metadata } from "next";
import "./globals.css";
import "./catalog-categories.css";
import "./home-v2.css";
import "./product-v2.css";
import "./pricing.css";
import "./product-checkout-v2.css";
import "./product-grouped-nominals.css";
import "./order.css";
import "./admin.css";
import "./admin-automation.css";
import "./admin-source-of-truth.css";
import "./midtrans.css";
import "./admin-digiflazz.css";
import "./admin-digiflazz-v2.css";
import "./admin-publish-checkbox.css";
import "./admin-supplier-link.css";

export const metadata: Metadata = {
  title: "Nambah — Top Up Cepat, Main Lagi",
  description: "Top up game dan voucher digital dengan proses simpel dan transparan.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
