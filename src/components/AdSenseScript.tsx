import { headers } from "next/headers";

/**
 * Loader Google AdSense (koneksi akun nyata untuk slot P4.5).
 *
 * Satu-satunya script iklan yang dimuat root layout. Aturannya:
 *
 * 1. ENV-GATED. Tanpa `NEXT_PUBLIC_ADSENSE_CLIENT`, komponen ini mereturn
 *    null — dev/sandbox/staging tidak pernah memuat script Google sama
 *    sekali, sehingga tidak ada request iklan asli dari lingkungan uji
 *    (klik pada iklan sendiri adalah pelanggaran kebijakan AdSense,
 *    mencegahnya sejak sumber lebih aman daripada meminta admin hafal
 *    larangan).
 *
 * 2. NONCE PER REQUEST. CSP production memakai `'strict-dynamic'` (lihat
 *    `src/lib/csp.ts`) yang menyatakan lembar allowlist host di
 *    script-src DIBIARKAN — hanya script yang punya nonce yang boleh hidup,
 *    dan script yang dimuat olehnya mewarisi izin itu.
 *    `adsbygoogle.js` yang menyuntik script turunan (mis. tag mendampingi
 *    di dalam iframe) sehingga loader ini HARUS membawa nonce.
 *    Nonce dirender middleware ke header request `x-nonce`; root layout
 *    dipaksa dynamic (`src/app/layout.tsx`) supaya nonce benar.
 */

const ADSENSE_LOADER_BASE =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

export default async function AdSenseScript() {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  if (!client) return null;

  const nonce = (await headers()).get("x-nonce");

  const src = `${ADSENSE_LOADER_BASE}?client=${encodeURIComponent(client)}`;

  return (
    <script
      async
      src={src}
      crossOrigin="anonymous"
      nonce={nonce ?? undefined}
    />
  );
}
