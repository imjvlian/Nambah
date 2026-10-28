function midtransDomains() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    isProduction,
    script: isProduction
      ? "https://app.midtrans.com"
      : "https://app.sandbox.midtrans.com https://app.midtrans.com",
    connect: isProduction
      ? "https://api.midtrans.com"
      : "https://api.sandbox.midtrans.com https://api.midtrans.com",
  };
}

/**
 * Domain Google AdSense (koneksi akun nyata untuk slot order-summary).
 *
 - * LOADER (`adsbygoogle.js` dari pagead2) di production TIDAK diterjunkan
 * lewat allowlist host: `'strict-dynamic'` membuat semua daftar host di
 * script-src diabaikan, jadi memasangnya di sana hanya memberi kesan aman
 * tanpa berpengaruh. Loader dipasang `<AdSenseScript />` dengan nonce
 * per-request, dan script berturutannya mewarisi izin nonce itu.
 * Dengan demikian, entri host di `script` di bawah HANYA untuk development
 * (yang memakai 'unsafe-inline', tanpa strict-dynamic, sehingga allowlist
 * host bekerja).
 *
 * Entri lainnya adalah permintaan isi iklan yang memang keluar/masuk ke
 * domain Google: fetch beacon (connect-src), iframe renderer (frame-src),
 * dan aset gambar (img-src).
 */
function adsenseDomains() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    isProduction,
    script: isProduction
      ? ""
      : "https://pagead2.googlesyndication.com",
    connect:
      "https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://adservice.google.com",
    frame: "https://googleads.g.doubleclick.net https://tpc.googlesyndication.com",
    img: "https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://googleads.g.doubleclick.net https://adservice.google.com",
  };
}

export function contentSecurityPolicy(nonce: string): string {
  const { isProduction, script, connect } = midtransDomains();
  const ad = adsenseDomains();

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src 'self' data: blob: https://res.cloudinary.com https://*.googleusercontent.com https://*.ggpht.com${ad.img ? ` ${ad.img}` : ""}`,
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    isProduction
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${script} https://challenges.cloudflare.com`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${script} https://challenges.cloudflare.com ${ad.script}`,
    `connect-src 'self' https://*.supabase.co ${connect} https://api.digiflazz.com https://api.brevo.com https://gate.volsever.com https://challenges.cloudflare.com ${ad.connect}`,
    `frame-src ${script} https://*.midtrans.com https://challenges.cloudflare.com ${ad.frame}`,
    isProduction ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
