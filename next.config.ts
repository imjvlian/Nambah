import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://app.sandbox.midtrans.com https://app.midtrans.com`,
  "connect-src 'self' https://*.supabase.co https://api.sandbox.midtrans.com https://api.midtrans.com https://api.digiflazz.com https://api.brevo.com https://gate.volsever.com",
  "frame-src https://app.sandbox.midtrans.com https://app.midtrans.com https://*.midtrans.com",
  isProduction ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(self), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

/*
 * CATATAN REDIRECT SUBDOMAIN
 *
 * Sebelumnya `/merchant` dialihkan ke `https://merchant.nambah.my.id` lewat
 * `redirects()` di file ini. Redirect itu DIHAPUS, karena `/merchant`
 * sekarang menjadi halaman portal yang nyata: pemilik toko membuka
 * `/merchant`, login di sana, lalu memilih ke kasir atau ke riwayat.
 *
 * Kalau `/merchant` masih dialihkan, halaman portalnya tidak akan pernah
 * terlihat - dan yang lebih buruk, di host `merchant.nambah.my.id` sendiri
 * pola `/merchant` akan cocok lagi dan mengarahkan ke URL yang sama,
 * menjadi redirect berulang.
 *
 * Kalau pemisahan host masih diinginkan, jangan lewat `redirects()` dengan
 * pola polos. Batasi ke host asal, misalnya dengan `has: [{ type: 'header',
 * key: 'host', value: 'nambah.my.id' }]`, supaya host merchant tidak ikut
 * menyala dan tidak ada risiko loop.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        /*
         * ATURAN SINGKEL untuk semua route, termasuk halaman pelanggan.
         *
         * `frame-ancestors 'none'` + `X-Frame-Options: DENY` berarti tidak
         * ada halaman yang boleh di-embed, oleh siapa pun. Itu memang
         * benar: tanpa ini, penyerang bisa membungkus halaman checkout di
         * iframe miliknya dan meniru tampilannya untuk mencuri kredensial
         * (clickjacking).
         *
         * Pratinjau receipt admin TIDAK butuh pengecualian di sini. Ia
         * memakai `srcDoc` (lihat `ReceiptPreview.tsx`), jadi isinya
         * menjadi dokumen milik panel admin sendiri — tidak ada navigasi
         * jaringan, tidak ada origin baru, dan `frame-ancestors` tidak
         * relevan karena tidak ada iframe lintas dokumen.
         *
         * Percobaan sebelumnya sempat melonggarkan header untuk route
         * preview dan itu tidak memperbaiki apa pun: `X-Frame-Options`
         * menang atas CSP, dan `sandbox="allow-same-origin"` tanpa
         * `allow-scripts` membuat iframe mendapat opaque origin yang
         * ditolak meski header sudah benar. Masalahnya ada di sisi klien.
         *
         * JANGAN longgarkan aturan ini untuk route baru tanpa alasan
         * yang benar-benar 유사. Pengecualian selalu berarti mengurangi
         * proteksi di seluruh situs.
         */
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
