import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guard test untuk proxy icon game (hotfix 17 Okt 2026).
 *
 * Sebelumnya route /api/icons/game membalas 307 ke domain eksternal
 * (mzstatic / googleusercontent / iconify). CSP img-src yang diperketat
 * di P0 security memblokir sebagian domain itu SETELAH redirect — gejala:
 * tile icon kosong diam-diam untuk game tanpa artwork manifest lokal.
 *
 * Route file tidak bisa diimpor langsung di node:test (next/server), jadi
 * dikunci level-source — pola yang sama dengan refund-flow dan
 * order-verification-gate.
 */

const source = readFileSync("src/app/api/icons/game/route.ts", "utf8");

test("route icon tidak boleh kembali memakai redirect eksternal", () => {
  assert.ok(!source.includes("NextResponse.redirect"), "redirect 307 dilarang — CSP memblokir domain tujuan");
  assert.ok(!source.includes("status: 307"));
  assert.ok(source.includes("proxyIcon"), "harus proxy lewat server");
});

test("proxy punya pertahanan: timeout, content-type, dan batas ukuran", () => {
  assert.ok(source.includes("AbortController"), "timeout wajib ada");
  assert.ok(source.includes("PROXY_TIMEOUT_MS"));
  assert.ok(source.includes("MAX_ICON_BYTES"), "batas ukuran wajib ada");
  assert.ok(/\/\^image\\\/\//.test(source), "content-type image/* wajib divalidasi");
});

test("respons proxy tetap di-cache lama + sumber tercatat", () => {
  assert.ok(source.includes("Cache-Control"));
  assert.ok(source.includes("s-maxage"), "CDN cache header harus tetap ada");
  assert.ok(source.includes("X-Nambah-Icon-Source"));
});

test("fallback SVG inisial tetap jadi lapisan terakhir — tile tidak pernah blank", () => {
  assert.ok(source.includes("fallbackSvg"));
  assert.ok(source.includes("image/svg+xml"));
  assert.ok(source.includes('"fallback"'));
  // Kegagal satu upstream harus jatuh ke kandidat berikutnya, bukan langsung
  // ke error: kalau proxyIcon mengembalikan null, loop lanjut.
  assert.ok(
    source.includes("const proxied = await proxyIcon(iconUrl, candidate.source)"),
    "setiap kandidat harus lewat proxy dengan fallback lanjut",
  );
});
