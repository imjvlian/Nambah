import { revalidateTag } from "next/cache";

/**
 * Penginvalidan cache server.
 *
 * MODUL INI SENGAJA HANYA MENGIMPOR `next/cache`.
 *
 * Alasannya untuk mencegah circular dependency:
 *
 *   supabase/server.ts  ->  cache-invalidation.ts   (daun, tanpa import)
 *   catalog-cache.ts    ->  cache-invalidation.ts   (daun)
 *   catalog-cache.ts    ->  catalog-repository.ts   ->  supabase/server.ts
 *
 * Kalau `supabase/server.ts` mengimpor dari `catalog-cache.ts`, rantai itu
 * menjadi lingkaran. Lingkaran ESM tidak selalu langsung meledak - ia biasanya
 * muncul jauh kemudian sebagai `undefined is not a function` di tempat yang
 * tidak kita dugali. Modul daun memutus masalahnya di akar.
 *
 * JANGAN tambahkan import dari `@/lib/*` ke file ini tanpa memikirkannya.
 */

/**
 * Tag cache katalog publik.
 *
 * Satu tag untuk seluruh katalog. Alasannya: katalog dibaca sebagai satu
 * dokumen (`getPublicCatalog()` merakit games + products + payment_methods +
 * orders + supplier_products), jadi membaginya jadi beberapa tag tidak
 * memberi keuntungan apa pun - hanya menambah tempat salah invalidasi.
 */
export const PUBLIC_CATALOG_TAG = "public-catalog";

/**
 * Tabel yang isinya memengaruhi etalase publik.
 *
 * Dipakai oleh `noteCatalogWrite()` untuk membuang cache tanpa perlu setiap
 * route admin mengingat tabel mana yang relevan.
 *
 * `orders` TIDAK ada di sini meski menjadi sumber "produk populer". Pesanan
 * baru tidak mengubah katalog, hanya peringkatnya, dan peringkat itu
 * digerakkan oleh TTL. Menaruh `orders` di sini berarti setiap order baru
 * membuang cache dan memicu query katalog penuh - persis yang kita hindari.
 *
 * `supplier_balances` juga tidak: etalase publik tidak menampilkan saldo
 * supplier, jadi mutasinya tidak perlu menyentuh cache ini.
 *
 * `payment_methods` dibaca katalog tapi tidak pernah ditulis dari `src/`
 * (tabel referensi yang dikelola di luar aplikasi), jadi tidak ada gunanya
 * dimasukkan.
 */
const CATALOG_TABLES = new Set(["games", "products", "supplier_products"]);

/**
 * Buang cache katalog.
 *
 * Aman dipanggil dari mana saja - termasuk di luar request. `revalidateTag` butuh "static generation store" yang hanya ada selama request
 * atau server action, sehingga di job terjadwal (cron reconciliation,
 * sinkronisasi supplier) pemanggilannya akan melempar. Itu TIDAK boleh
 * menggagalkan job: kesegaran dijaga TTL, jadi kegagalan invalidasi hanya
 * berarti katalog basi paling lama 60 detik - jauh lebih baik daripada cron
 * yang mati.
 *
 * SOAL `expire: 0`
 *
 * Di Next.js 16 `revalidateTag` butuh argumen kedua, dan `updateTag()` -
 * yang punya semantik read-your-own-writes - HANYA boleh dipanggil dari dalam
 * Server Action. Mutasi katalog di aplikasi ini terjadi di route handler
 * (`/api/admin/...`), bukan Server Action, jadi `updateTag` tidak tersedia.
 *
 * `{ expire: 0 }` adalah cara resmi untuk mengumantkan entri langsung dari
 * route handler: entri dianggap basi seketika, jadi pembacaan berikutnya -
 * termasuk yang sudah pagun berjalan di browser admin - membaca ulang dari
 * database. Efeknya sama dengan yang kita mau: admin menekan Simpan, etalase
 * langsung sesuai.
 */
export function invalidatePublicCatalog(): void {
  if (process.env.NODE_ENV !== "production") return;

  try {
    revalidateTag(PUBLIC_CATALOG_TAG, { expire: 0 });
  } catch {
    // Di luar request context (cron, seed, script). TTL yang menutupi.
  }
}

/**
 * Dipanggil setiap kali ada penulisan ke tabel katalog.
 *
 * Ini titik hook SATU-SATUNYA supaya tidak ada penulis yang terlewat.
 *
 * Rancangan yang sempat dipertimbangkan: menempelkan
 * `invalidatePublicCatalog()` di setiap route admin satu per satu. Itu rapuh,
 * karena route baru atau helper yang kelewatan akan diam-diam menyajikan data
 * lama sampai TTL habis - dan tidak ada yang mengetahuinya. Dengan hook di
 * lapisan data, admin route, cron, webhook, dan helper sekalian kena.
 */
export function noteCatalogWrite(table: string): void {
  if (!CATALOG_TABLES.has(table)) return;
  invalidatePublicCatalog();
}
