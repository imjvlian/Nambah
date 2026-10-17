/**
 * Resolve hook untuk test runner: memetakan `@/...` → `src/...`.
 *
 * Next.js memetakan alias `@/` lewat `tsconfig.json` `paths`, tapi test
 * dijalankan dengan `node --experimental-strip-types` yang TIDAK membaca
 * `tsconfig`. Tanpa hook ini, modul yang mengimpor `@/lib/...` — misalnya
 * `product-identity.ts` — gagal dimuat dengan `ERR_MODULE_NOT_FOUND`.
 *
 * Hook ini hanya untuk test. Kode aplikasi tetap apa adanya.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

export function resolve(specifier, context, nextResolve) {
  if (specifier === "@" || specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    return nextResolve(pathToFileURL(withExtension(path.join(SRC_ROOT, relative))).href, context);
  }

  // Next.js boleh mengimpor tanpa ekstensi (`@/lib/game-targets`), Node tidak.
  // Test runner memakai resolver Node, jadi ekstensinya ditambahkan di sini.
  if (specifier.startsWith(".") && !path.extname(specifier)) {
    const parentPath = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : process.cwd();
    const target = path.resolve(parentPath, specifier);
    return nextResolve(pathToFileURL(withExtension(target)).href, context);
  }

  // Subpath Next.js tanpa ekstensi, misalnya `next/cache`. Kode aplikasi boleh
  // menuliskannya begitu karena bundler Next me-resolve-nya; resolver Node tidak,
  // karena package `next` tidak punya peta `exports` untuk `./cache`. File-nya
  // sendiri ada sebagai `next/cache.js`, jadi kita arahkan ke sana.
  //
  // Tanpa aturan ini, modul apa pun yang mengimpor `next/cache` akan gagal
  // dimuat di test dengan ERR_MODULE_NOT_FOUND - termasuk file di `src/lib`
  // yang diuji secara tidak langsung.
  if (/^next(\/[a-z0-9-]+)+$/i.test(specifier)) {
    return nextResolve(`${specifier}.js`, context);
  }

  return nextResolve(specifier, context);
}

/**
 * Tambahkan ekstensi jika file-nya belum punya.
 *
 * Hanya berlaku untuk `.ts` dan `.tsx` — bukan `.js`, yang sudah boleh ditulis
 * eksplisit dan yang eksplisitnya tidak boleh diubah.
 */
function withExtension(target) {
  if (path.extname(target)) return target;
  for (const ext of [".ts", ".tsx"]) {
    if (existsSync(target + ext)) return target + ext;
  }
  return target;
}