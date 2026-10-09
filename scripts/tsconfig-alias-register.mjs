/**
 * Mendaftarkan resolve hook alias `@/` untuk test runner.
 *
 * Dipakai lewat `--import`, bukan `--loader`, supaya hook aktif untuk seluruh
 * proses — termasuk modul yang diimpor dari dalam file test.
 *
 * `register()` me-resolve specifier relatif terhadap BERISI file ini. File ini
 * dimuat lewat URL `data:` dari flag `--import`, jadi tidak ada base
 * hierarkis untuk path relatif. Karena itu path-nya absolut dari
 * `process.cwd()`.
 *
 * Hook-nya ada di `tsconfig-alias-loader.mjs`.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

register(pathToFileURL(path.join(process.cwd(), "scripts", "tsconfig-alias-loader.mjs")));