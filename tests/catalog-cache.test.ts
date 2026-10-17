import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Cache katalog publik.
 *
 * `getPublicCatalog()` (`src/lib/catalog-repository.ts`) melakukan LIMA query
 * PostgREST per pemanggilan, termasuk seribu baris `orders` yang hanya dipakai
 * untuk menghitung urutan "Populer". Dipanggil apa adanya dari homepage, setiap
 * halaman produk, `/api/catalog`, dan setiap crawl sitemap, itu mahal dan tidak
 * proporsional untuk data yang nyaris statis.
 *
 * `src/lib/catalog-cache.ts` membungkusnya dengan `unstable_cache`. Test ini
 * menjaga lima hal yang tidak terlihat kalau hilang:
 *
 *   1. Semua pemanggilPUBLIK memakai wrapper cache, bukan fungsi mentah.
 *   2. Cache punya tag dan TTL, jadi bisa dibuang dan tidak menggantung.
 *   3. Mutasi katalog di panel admin langsung membuang cache.
 *   4. Invalidasi hanya untuk scope katalog + method bermutasi.
 *   5. `supabase/server.ts` tetap bebas import `next/cache`.
 *
 * Poin 5 terdengar sepele, tapi batasan itu nyata. `src/lib/supabase/server.ts`
 * sengaja nol import supaya bisa dimuat di Node polos oleh test runner. Begitu
 * `next/cache` masuk ke sana, `tests/rate-limit.test.ts` dan enam test lain
 * mati dengan ERR_MODULE_NOT_FOUND - semua karena satu baris import. Test ini
 * menjaga supaya itu tidak terulang.
 */

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) walk(relative, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative);
  }
  return out;
}

const cacheSource = read("src/lib/catalog-cache.ts");
const adminApiSource = read("src/lib/admin-api.ts");
const invalidationSource = read("src/lib/cache-invalidation.ts");

test("cache katalog dibungkus unstable_cache dengan tag dan TTL", () => {
  assert.match(
    cacheSource,
    /unstable_cache\(/,
    "catalog-cache.ts harus memakai unstable_cache.",
  );
  assert.match(
    cacheSource,
    /PUBLIC_CATALOG_TAG/,
    "cache harus punya tag supaya bisa diinvalidasi tepat sasaran.",
  );
  assert.match(
    cacheSource,
    /tags:\s*\[PUBLIC_CATALOG_TAG\]/,
    "tag harus didaftarkan di unstable_cache, kalau tidak revalidateTag tidak berefek.",
  );

  const ttl = cacheSource.match(/CATALOG_REVALIDATE_SECONDS\s*=\s*(\d+)/);
  assert.ok(ttl, "harus ada konstanta TTL yang eksplisit.");
  const seconds = Number(ttl[1]);

  assert.ok(
    seconds > 0 && seconds <= 300,
    `TTL ${seconds} detik tidak masuk akal. TTL ini hanya jaring pengaman ` +
      "karena mutasi katalog menginvalidasi cache secara langsung; kalau TTL " +
      "sangat panjang, mutasi yang terlewat berarti etalase basi lama sekali.",
  );
});

/**
 * Buang komentar sebelum memindai.
 *
 * Tanpa ini, dokumentasi yang menyebut `getPublicCatalog()` dilaporkan sebagai
 * pemanggil liar - persis yang terjadi pada versi pertama test ini: satu-satunya
 * "offender" adalah penjelasan di `cache-invalidation.ts`.
 *
 * Penjaga `[^:]` mencegah `https://` di dalam string dianggap awal komentar.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("semua pemanggil publik memakai wrapper cache", () => {
  /*
   * Daftar ini berasal dari hasil pemindaian seluruh `src/`. Kalau ada pemanggil baru
   * yang langsung memakai `getPublicCatalog()`, tambahkan ke daftar ini dengan
   * alasan yang jelas - kalau tidak, cache ini tidak berguna untuk route itu.
   */
  const expectedCallers = [
    "src/app/page.tsx",
    "src/app/product/[id]/page.tsx",
    "src/app/api/catalog/route.ts",
    "src/app/sitemap.ts",
  ];

  for (const file of expectedCallers) {
    const source = read(file);
    assert.match(
      source,
      /getCachedPublicCatalog/,
      `${file} harus memakai getCachedPublicCatalog().`,
    );
    assert.doesNotMatch(
      stripComments(source),
      /(?<![a-zA-Z])getPublicCatalog\(\)/,
      `${file} masih memanggil getPublicCatalog() langsung - 5 query per request.`,
    );
  }

  // Tidak boleh ada pemanggil lain yang lolos dari cache.
  const offenders = walk("src")
    .filter((file) => file !== "src/lib/catalog-cache.ts")
    .filter((file) => file !== "src/lib/catalog-repository.ts")
    .filter((file) =>
      /(?<![a-zA-Z])getPublicCatalog\(\)/.test(stripComments(read(file))),
    );

  assert.deepEqual(
    offenders,
    [],
    `File ini memanggil getPublicCatalog() langsung dan melewati cache:\n${offenders.join("\n")}`,
  );
});

test("halaman yang dirender memakai cache tidak menjadi static", () => {
  /*
   * `force-dynamic` di root layout WAJIB tetap ada. Cache data dan cache
   * halaman adalah dua hal terpisah: data boleh di-cache, tapi HTML harus
   * dirender per request supaya nonce CSP-nya benar. Kalau suatu saat
   * `force-dynamic` dihapus dengan alasan "kan sudah ada cache", nonce hilang dan
   * seluruh JavaScript diblokir - bug yang sama seperti production Oktober 2026.
   */
  assert.match(
    read("src/app/layout.tsx"),
    /dynamic\s*=\s*"force-dynamic"/,
    "src/app/layout.tsx harus tetap force-dynamic - cache data tidak menggantikan CSP nonce.",
  );
});

test("mutasi katalog di admin membuang cache etalase", () => {
  assert.match(
    adminApiSource,
    /invalidatePublicCatalog\(\)/,
    "admin-api.ts harus memanggil invalidatePublicCatalog().",
  );
  assert.match(
    adminApiSource,
    /routeScopeFor\([^)]*\)\s*===\s*"katalog"/,
    "invalidasi harus dibatasi ke scope katalog. Tanpa itu, memproses refund " +
      "atau mengirim ulang receipt akan ikut membuat etalase ter-cold-start.",
  );
  assert.match(
    adminApiSource,
    /MUTATING_METHODS\.has\(/,
    "invalidasi harus dibatasi ke method bermutasi. Tanpa itu, polling GET " +
      "dashboard admin akan menghapus cache terus-menerus.",
  );
});

test("scope katalog mencakup semua route yang bisa mengubah etalase", () => {
  const scopeSource = read("src/lib/admin-scope.ts");

  for (const prefix of [
    "/api/admin/catalog",
    "/api/admin/digiflazz",
    "/api/admin/melostore",
  ]) {
    assert.ok(
      scopeSource.includes(`"${prefix}"`),
      `Prefix ${prefix} harus ada di ROUTE_SCOPE dengan scope katalog, ` +
        "kalau tidak route itu tidak akan menginvalidasi cache.",
    );
  }
});

test("tidak ada route admin katalog yang membaca cache katalog", () => {
  /*
   * Ini yang membuat invalidasi SEBELUM penulisan aman, dan sekarang
   * kenyataannya dijamin, bukan sekadar dijelaskan di komentar.
   *
   * Urutannya: `authorizeAdminRequest` membuang cache, lalu handler menulis ke
   * database. Kalau di antara dua langkah itu ada handler yang membaca
   * `getCachedPublicCatalog()`, dia akan ME-CACHE data lama - dan etalase akan
   * menampilkan harga basi sampai TTL habis, justru setelah admin menekan
   * Simpan. Itu kebalikan dari yang kita mau.
   *
   * Route admin memang selalu membaca lewat `supabaseSelect*` langsung ke
   * database. Test ini menjaga supaya tidak ada yang diam-diam mengubahnya.
   */
  const offenders = walk("src/app/api/admin").filter((file) =>
    /getCachedPublicCatalog/.test(stripComments(read(file))),
  );

  assert.deepEqual(
    offenders,
    [],
    "Route admin tidak boleh membaca cache katalog. Admin harus melihat data " +
      "segera setelah menulis, bukan data yang sudah di-cache:\n" +
      offenders.join("\n"),
  );
});

test("invalidasi aman di luar request", () => {
  /*
   * Cron (`/api/cron/*`, systemd timer) menulis lewat jalur yang sama.
   * `revalidateTag` melempar di luar request context, dan job yang melempar
   * lebih buruk daripada data basi - jadi kegagalan harus ditelan, dengan TTL
   * yang menutupi.
   */
  assert.match(
    invalidationSource,
    /try\s*\{[\s\S]*?revalidateTag\([\s\S]*?\}\s*catch/,
    "invalidatePublicCatalog() harus dibungkus try/catch agar job terjadwal tidak ikut gagal.",
  );
});

test("orders tidak ikut menginvalidasi cache katalog", () => {
  /*
   * `orders` adalah sumber "produk populer", tapi pesanan baru tidak mengubah
   * katalog. Kalau `orders` ikut menginvalidasi, setiap order yang masuk akan
   * membuang cache dan memicu lima query penuh - persis beban yang sedang
   * dihapus oleh cache ini. Kesegaran peringkat diurus TTL.
   */
  const tablesMatch = invalidationSource.match(
    /CATALOG_TABLES\s*(?::[^=]*)?=\s*new Set\(\[([^\]]*)\]\)/,
  );
  assert.ok(tablesMatch, "harus ada daftar CATALOG_TABLES yang eksplisit.");

  const listed = tablesMatch[1]!;
  assert.ok(
    listed.includes("games") && listed.includes("products") && listed.includes("supplier_products"),
    "daftar harus mencakup games, products, dan supplier_products.",
  );
  assert.ok(
    !listed.includes("orders"),
    "`orders` TIDAK boleh ada di daftar - setiap order baru akan membuang cache katalog.",
  );
});

test("supabase/server.ts tetap bebas import next/cache", () => {
  const supabaseServer = read("src/lib/supabase/server.ts");

  assert.doesNotMatch(
    supabaseServer,
    /from\s+["']next\//,
    "src/lib/supabase/server.ts harus tetap tanpa import dari next/* - file ini " +
      "sengaja nol import supaya bisa dimuat di Node polos oleh test runner. " +
      "Menambahkan next/cache di sini mematikan 7 test dengan ERR_MODULE_NOT_FOUND.",
  );
  assert.doesNotMatch(
    supabaseServer,
    /cache-invalidation/,
    "Jangan menaruh hook invalidasi di lapisan data Supabase. Taruh di " +
      "admin-api.ts, yang tidak diuji lewat import.",
  );
});

test("migrasi index katalog publik ada dan bentuknya benar", () => {
  /*
   * Cache mengurangi SEBERAPA KALI query ini jalan, tapi tidak mengurangi
   * biaya sekali jalan. Tanpa index, setiap cache miss memindai seluruh
   * `orders` - dan tabel itu hanya bertambah.
   *
   * Partial index dengan predikat status + urutan `created_at desc` adalah
   * yang melayani persis bentuk query di `catalog-repository.ts`.
   */
  const migration = read("supabase/migrations/20261017_055_public_catalog_indexes.sql");

  assert.match(
    migration,
    /create\s+index\s+if\s+not\s+exists\s+orders_public_popularity_idx/i,
    "migrasi harus membuat orders_public_popularity_idx secara idempoten.",
  );
  assert.match(
    migration,
    /on\s+public\.orders\s*\(\s*created_at\s+desc\s*\)/i,
    "index harus diurutkan created_at DESC - query mengurutkan created_at DESC.",
  );

  const predicate = migration.match(/where\s+status\s+in\s*\(([^)]*)\)/i);
  assert.ok(predicate, "index harus punya predikat partial untuk status.");
  const statuses = [...predicate[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

  assert.deepEqual(
    statuses.slice().sort(),
    ["paid", "processing", "success"],
    "predikat harus sama persis dengan filter di getPublicCatalog(). Kalau " +
      "berbeda, predikat tidak akan dipakai dan index tidak pernah terpakai.",
  );
  assert.ok(
    !statuses.includes("pending_payment"),
    "`pending_payment` tidak pernah dihitung dan tidak boleh membloat index.",
  );
});
