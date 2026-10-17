import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Halaman static + CSP berbasis nonce = SETIAP script diblokir.
 *
 * `src/lib/csp.ts` di production memakai:
 *
 *   script-src 'self' 'nonce-<uuid>' 'strict-dynamic'
 *
 * Noncenya dibuat per request di `src/middleware.ts`. Next.js hanya bisa
 * menempelkan nonce itu ke tag <script> saat merender permintaan. Halaman yang
 * di-prerender saat build sudah dibakar tanpa nonce, tapi CSP tetap menuntut
 * satu - dan `'strict-dynamic'` mengabaikan `'self'`, jadi tidak ada fallback.
 * Hasilnya: seluruh JavaScript ditolak, halaman tidak pernah interaktif.
 *
 * Ditemukan di production 17 Oktober 2026: `/admin` tersangkut di
 * "Memuat Lacte Game Store Control Center..." selamanya, semua JS-nya
 * `(blocked:csp)` di DevTools.
 *
 * Test ini menahan dua hal:
 *
 * 1. Root layout WAJIB punya `force-dynamic`. Karena `dynamic` diwarisi ke
 *    seluruh segment turunan, satu baris itu menutup setiap halaman yang ada
 *    sekarang dan setiap halaman yang akan datang.
 *
 * 2. Tidak ada segment yang boleh override `dynamic` ke nilai lain. Nilai di
 *    segment dalam MENIMPA nilai di segment luar, jadi `dynamic = "auto"` di
 *    layout anak akan mematikan kontrol ini untuk semua halaman di bawahnya -
 *    persis bug yang sedang dicegah, dengan bentuk yang lebih halus.
 *
 * Catatan: yang diuji di sini adalah KEBIJAKAN KODE, bukan output build.
 * Bukti bahwa kebijakan ini benar-benar bekerja datang dari `npm run build` -
 * di sana setiap halaman seharusnya tampil `ƒ`, bukan `○`.
 */

const APP_DIR = join(process.cwd(), "src", "app");
const COMPONENT_DIR = join(process.cwd(), "src", "components");

const FORCE_DYNAMIC_RE =
  /export\s+const\s+dynamic\s*(?::[^=]+)?=\s*["']force-dynamic["']/;
const DECLARED_DYNAMIC_RE =
  /export\s+const\s+dynamic\s*(?::[^=]+)?=\s*["']([^"']+)["']/;
const USE_CLIENT_RE =
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*["']use client["']/;

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    if (entry === "page.tsx" || entry === "layout.tsx") found.push(full);
  }
  return found;
}

function segmentPath(fullPath: string): string {
  return (
    fullPath
      .slice(APP_DIR.length)
      .replace(/[\\/]page\.tsx$/, "")
      .replace(/[\\/]layout\.tsx$/, "")
      .replace(/\\/g, "/") || "/"
  );
}

function read(fullPath: string): string {
  return readFileSync(fullPath, "utf8");
}

/** Klien yang dipakai file di `@/components/Xyz` (satu tingkat, cukup untuk guard). */
function importsClientComponent(source: string): boolean {
  const names = [
    ...source.matchAll(/from\s+["']@\/components\/([A-Za-z0-9_]+)["']/g),
  ].map((m) => m[1]!);

  for (const name of names) {
    try {
      if (USE_CLIENT_RE.test(read(join(COMPONENT_DIR, `${name}.tsx`)))) {
        return true;
      }
    } catch {
      // Komponen tidak ketemu - bukan urusan test ini.
    }
  }
  return false;
}

/**
 * `dynamic` diwarisi ke segment turunan, dan nilai di segment yang lebih dalam
 * MENIMPA nilai di atasnya. Jadi tidak cukup hanya melihat layout di direktori
 * yang sama - harus menelusuri seluruh rantai sampai `src/app`.
 */
function forceDynamicInAncestorChain(fullPath: string): boolean {
  let dir = join(fullPath, "..");

  for (;;) {
    for (const file of [join(dir, "layout.tsx"), join(dir, "page.tsx")]) {
      try {
        if (FORCE_DYNAMIC_RE.test(read(file))) return true;
      } catch {
        // Segment ini tidak punya file tersebut.
      }
    }

    if (dir === APP_DIR) return false;
    const parent = join(dir, "..");
    if (parent === dir) return false;
    dir = parent;
  }
}

test("root layout mewajibkan force-dynamic untuk seluruh aplikasi", () => {
  assert.ok(
    FORCE_DYNAMIC_RE.test(read(join(APP_DIR, "layout.tsx"))),
    'src/app/layout.tsx harus punya `export const dynamic = "force-dynamic"` - ' +
      "tanpa itu halaman static akan di-prerender tanpa nonce dan semua " +
      "script-nya diblokir CSP. Lihat penjelasan panjang di file itu.",
  );
});

test("tidak ada segment yang override dynamic ke nilai lain", () => {
  const offenders: string[] = [];

  for (const file of walk(APP_DIR)) {
    const match = read(file).match(DECLARED_DYNAMIC_RE);
    if (!match) continue;
    if (match[1] === "force-dynamic") continue;

    const kind = file.endsWith("layout.tsx") ? "layout" : "page";
    offenders.push(`${segmentPath(file)} (${kind}) = "${match[1]}"`);
  }

  assert.deepEqual(
    offenders,
    [],
    "Segment ini override `dynamic` ke nilai selain force-dynamic. Nilai di " +
      "segment dalam menimpa nilai di segment luar, jadi ini mematikan kontrol " +
      "CSP untuk seluruh halaman di bawahnya:\n" +
      offenders.map((o) => `  - ${o}`).join("\n"),
  );
});

test("setiap halaman dengan client component punya force-dynamic", () => {
  const offenders: string[] = [];

  for (const file of walk(APP_DIR)) {
    if (file.endsWith("layout.tsx")) continue;

    const source = read(file);
    const itselfClient = USE_CLIENT_RE.test(source);
    if (!itselfClient && !importsClientComponent(source)) continue;

    if (!forceDynamicInAncestorChain(file)) offenders.push(segmentPath(file));
  }

  assert.deepEqual(
    offenders,
    [],
    "Halaman ini memuat client component tapi tidak punya force-dynamic di " +
      "page-nya maupun di layout mana pun di atasnya, jadi akan di-prerender " +
      "tanpa nonce dan script-nya diblokir CSP:\n" +
      offenders.map((p) => `  - ${p}`).join("\n"),
  );
});

test("middleware tetap mengirim nonce dan memasang CSP", () => {
  const middleware = read(join(process.cwd(), "src", "middleware.ts"));
  assert.match(
    middleware,
    /crypto\.randomUUID\(\)/,
    "middleware harus membuat nonce per request.",
  );
  assert.match(
    middleware,
    /contentSecurityPolicy\(/,
    "middleware harus memasang CSP lewat contentSecurityPolicy().",
  );
});

test("hanya production yang memakai nonce + strict-dynamic", () => {
  const csp = read(join(process.cwd(), "src", "lib", "csp.ts"));
  assert.match(
    csp,
    /nonce-\$\{nonce\}/,
    "csp.ts harus menyisipkan nonce di script-src production.",
  );
  assert.match(
    csp,
    /strict-dynamic/,
    "csp.ts harus memakai strict-dynamic di production.",
  );
  assert.match(
    csp,
    /isProduction\s*\?/,
    "csp.ts harus membedakan production dan non-production - development " +
      "memakai unsafe-inline sehingga bug ini tidak muncul di localhost.",
  );
});