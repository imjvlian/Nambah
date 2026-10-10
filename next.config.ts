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
 * Host untuk layar kasir dan pendaftaran toko.
 *
 * SENGAJA ditulis sebagai konstanta, bukan diturunkan dari `BRAND.domain`.
 * `BRAND.domain` masih `nambah.id` - itu pilihan yang disengaja supaya
 * domain lama yang sudah terindeks Google tidak hilang (lihat `brand.ts`).
 * Mengambil subdomain dari sana akan menghasilkan host yang salah sekali
 * deploy.
 *
 * Kalau nanti hostnya dipindah ke domain sendiri, ubah SATU tempat ini.
 */
const MERCHANT_HOST = "merchant.nambah.my.id";

const nextConfig: NextConfig = {
  poweredByHeader: false,

  /*
   * `/merchant` -> host kasir.
   *
   * Tiga keputusan, semuanya berdasarkan dacang yang bisa balik:
   *
   * 1. HANYA DI PRODUKSI. Redirect ini memindahkan orang ke host lain. Kalau
   *    aktif di pengembangan, `/merchant` langsung hilang dan seluruh
   *    pengujian layar kasir di localhost ikut mati - padahal halaman
   *    `/merchant/kasir` dan `/merchant/register` justru masih hidup di
   *    host utama dan masih dipakai untuk pengujian.
   *
   * 2. SEMENTARA (307), BUKAN PERMANEN (308). Subdomain-nya belum tentu
   *    siap. 308 memberi tahu browser untuk meng-cache redirect SELAMANYA -
   *    jadi kalau subdomainnya belum ada, orang menyimpan halaman 404 dan
   *    tetap menyimpannya bahkan setelah subdomain-nya diperbaiki. 307 tidak
   *    di-cache, jadi memperbaiki target cukup dilakukan sekali di server.
   *
   * 3. POLA `/merchant` TANPA `/:path*`. Redirect di sini dicek sebelum
   *    filesystem, jadi pola yang longgar akan ikut menyapu
   *    `/merchant/kasir` dan `/merchant/register` - dua halaman yang masih
   *    hidup dan masih dipakai. Pola tanpa segmen tambahan hanya cocok
   *    persis dengan `/merchant`.
   */
  async redirects() {
    if (!isProduction) return [];

    return [
      {
        source: "/merchant",
        destination: `https://${MERCHANT_HOST}`,
        permanent: false,
      },
    ];
  },

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
