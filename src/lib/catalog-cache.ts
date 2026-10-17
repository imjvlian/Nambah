import { unstable_cache } from "next/cache";
import {
  invalidatePublicCatalog,
  PUBLIC_CATALOG_TAG,
} from "@/lib/cache-invalidation";
import { getPublicCatalog, type PublicCatalogResult } from "@/lib/catalog-repository";

/**
 * Cache katalog publik.
 *
 * MASALAH YANG DISELESAIKAN
 *
 * `getPublicCatalog()` ada di `src/lib/catalog-repository.ts:235` dan memakai
 * `supabaseSelectAll` yang semuanya `cache: "no-store"` di
 * `src/lib/supabase/server.ts`. Kalau dipanggil apa adanya, satu page view
 * berarti LIMA perjalanan ke PostgREST:
 *
 *   1. games      (supabaseSelectAll - dipaginasi, bisa banyak round-trip)
 *   2. products   (supabaseSelectAll - dipaginasi, bisa banyak round-trip)
 *   3. payment_methods
 *   4. orders     (1000 baris, hanya untuk menghitung produk populer)
 *   5. supplier_products  (setelah Promise.all, jadi berurutan)
 *
 * Poin 4 yang paling mahal dan paling tidak proporsional: seribu baris
 * `orders` diunduh ke runtime Node hanya untuk menghitung peta frekuensi yang
 * hasilnya dipakai sebagai urutan "Populer".
 *
 * Data itu nyaris statis. Games dan payment_methods jarang berubah. Product
 * berubah hanya lewat panel admin atau sinkronisasi katalog supplier. Yang
 * benar-benar sering berubah adalah "produk populer" - dan itu pun tidak perlu
 * presisi detik.
 *
 * SEBELUM: homepage, setiap halaman produk, /api/catalog, dan setiap crawl
 * sitemap = 5 query. SETELAH: 0 query, dari cache.
 *
 * MENGAPA TIDAK CUMA `force-dynamic` SAJA
 *
 * `force-dynamic` di `src/app/layout.tsx` mengatur caching HALAMAN - itu wajib
 * untuk CSP nonce dan tidak boleh dilepas. Tapi halaman yang dirender per
 * request TIDAK berarti harus query database per request. Dua hal itu lapisan
 * berbeda; yang satu tidak menggantikan yang lain.
 *
 * KEDUA JALUR INI HARUS DIPAKAI BERSAMAAN
 *
 * `force-dynamic`  ->  HTML dirender per request supaya nonce-nya benar
 * cache di sini   ->  datanya diambil dari cache supaya tidak query database
 *
 * Menghapus yang satu tidak menghapus kebutuhan yang lain.
 *
 * SIAPA YANG MEMBUANG CACHE
 *
 * Bukan file ini. `noteCatalogWrite()` di `@/lib/cache-invalidation` dipanggil
 * dari dalam `supabaseInsert`/`supabaseUpsert`/`supabaseUpdate`/
 * `supabaseDelete`, jadi setiap penulis tabel katalog - route admin, cron,
 * webhook, atau helper - ikut kena tanpa harus ingat. TTL di bawah ini hanya
 * jaring pengaman, bukan mekanisme utama.
 */

/**
 * TTL fallback.
 *
 * Yang menjaga kesegaran adalah penginvalidan di lapisan data, sehingga ini
 * hanya catching case yang tidak tertangkap: mutasi lewat RPC yang menulis
 * tabel katalog, atau proses yang menulis di luar aplikasi. Untuk kasus itu
 * data basi paling lama 60 detik.
 *
 * Kenapa 60 detik dan bukan 5 menit: panel admin harus terasa instan. Kalau
 * admin menaikkan markup dan etalase masih menampilkan harga lama selama 5
 * menit, itu sumber komplain.
 *
 * Dan data basi di sini tidak bisa menyebabkan salah tagih. Checkout TIDAK
 * membaca katalog dari cache: `src/app/api/orders/route.ts:196` memanggil
 * `getPricingContext()` yang membaca baris produk segar dari database, lalu
 * `calculatePricing()` (`src/lib/pricing.ts:360`) menghitung dari baris itu.
 * Yang di-cache ini murni tampilan etalase dan halaman produk - harga yang
 * benar-benar ditagih selalu dihitung ulang di server.
 */
const CATALOG_REVALIDATE_SECONDS = 60;

/**
 * Cache aktif hanya di production.
 *
 * Di development, caching katalog hanya menambah kebingungan: admin mengubah
 * data lalu halaman masih menampilkan versi lama dan orang mengira perubahan
 * tidak masuk. `unstable_cache` berguna di production, menyebalkan di dev.
 */
const isProduction = process.env.NODE_ENV === "production";

async function readPublicCatalog(): Promise<PublicCatalogResult> {
  return getPublicCatalog();
}

const cachedRead = unstable_cache(readPublicCatalog, [PUBLIC_CATALOG_TAG], {
  revalidate: CATALOG_REVALIDATE_SECONDS,
  tags: [PUBLIC_CATALOG_TAG],
});

/**
 * Katalog publik, dari cache kalau ada.
 *
 * Dipakai oleh homepage (`src/app/page.tsx`), halaman produk, `/api/catalog`,
 * dan `src/app/sitemap.ts`.
 *
 * Jangan pernah menggantinya dengan `getPublicCatalog()` langsung di route -
 * itu akan mengembalikan 5 query per request dan membuat cache ini tidak
 * berguna.
 */
export async function getCachedPublicCatalog(): Promise<PublicCatalogResult> {
  if (!isProduction) return getPublicCatalog();
  return cachedRead();
}

export { invalidatePublicCatalog, PUBLIC_CATALOG_TAG };
