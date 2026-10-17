import { NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "@/lib/csp";

/**
 * Middleware CSP.
 *
 * Noncenya dibuat per request karena `src/lib/csp.ts` di production memakai
 * `'strict-dynamic'`, yang membuat CSP3 mengabaikan `'self'` dan daftar host:
 * hanya nonce atau hash yang bisa memuat script. Nonce harus BERBEDA setiap
 * request - inilah alasan seluruh aplikasi dipaksa `force-dynamic` di
 * `src/app/layout.tsx`. Jangan dihapus tanpa membaca file itu.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));

  return response;
}

/**
 * Matcher.
 *
 * CSP berlaku untuk DOKUMEN, bukan untuk berkas statis. Gambar, font, video,
 * dan stylesheet tidak dieksekusi sebagai dokumen, jadi header CSP di sana
 * sia-sia - tapi middleware tetap jalan untuk setiap satu dan tetap membangun
 * nonce yang tidak pernah dipakai siapa pun.
 *
 * `public/` berisi ~390 berkas (hampir semuanya gambar) yang diserve dari path
 * root seperti `/img/hero.png`. Semuanya cocok dengan pola catch-all lama,
 * jadi setiap gambar yang dimuat di homepage pernah menjalankan middleware
 * penuh: satu `crypto.randomUUID()`, satu string CSP dirakit, satu header
 * ditambahkan ke respons gambar.
 *
 * YANG SENGAJA TIDAK DIKECUALIKAN
 *
 * 1. `/api/` tidak dibuang secara blanket. `src/app/api/admin/receipt-preview`
 *    mengembalikan `text/html` - dokumen HTML sungguhan yang terlihat di
 *    browser, dan tanpa CSP di sana kita melepas kontrol pada halaman yang
 *    benar-benar dirender. Route API lain mengembalikan JSON atau gambar, tapi
 *    membedakannya per-route membutuhkan daftar baru yang harus dijaga;
 *    membiarkan CSP tetap di sana jauh lebih murah dan tidak pernah salah.
 *
 * 2. `json`, `css`, `js`, `map`, `txt`, dan `xml` TIDAK ada di daftar bawah.
 *    Semuanya berisiko menjadi nama halaman: `/product/<id>` mengambil id dari
 *    database, dan satu id yang berakhiran `.json` akan diam-diam kehilangan
 *    CSP tanpa error yang terlihat. Yang dilewati cuma ~3 dari 393 berkas di
 *    `public/`, jadi tidak sebanding dengan risikonya. `js` dan `css` sudah
 *    tercakup `_next/static` sejak awal.
 *
 * Daftar di bawah dipilih karena isinya benar-benar aset: gambar, font, video,
 * PDF, dan manifest - kategori yang tidak mungkin menjadi route halaman.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|gif|ico|avif|bmp|woff2?|ttf|otf|eot|webmanifest|mp4|webm|pdf)$).*)",
  ],
};
