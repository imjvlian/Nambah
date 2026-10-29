import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ADMIN_SCOPES,
  ROUTES_INTENTIONALLY_CLOSED,
  ROUTES_WITHOUT_AUTHORIZATION,
  ROUTE_SCOPE,
  SECTION_SCOPE,
  TOOL_SCOPE,
  allowedScopes,
  canAccessRoute,
  canAccessScope,
  firstAllowedSection,
  hasFullAdminAccess,
  isAdminScope,
  routeScopeFor,
  type AdminScope,
} from "../src/lib/admin-scope.ts";

/**
 * Hak akses admin per grup kerja.
 *
 * Dua hal yang dijaga di sini, dan keduanya mudah lolos kalau hanya satu
 * yang diuji.
 *
 * PERTAMA, fail-closed. Route yang tidak ada di peta harus MENOLAK role
 * admin. Kalau aturan ini dibalik - entri kosong berarti boleh semua -
 * setiap route yang lupa dipetakan berubah jadi lubang. Test di bawah
 * tidak hanya memeriksa aturan, tapi juga memeriksa filesystem: setiap
 * file route yang ada harus tercakup peta atau masuk daftar pengecualian.
 *
 * KEDUA, konsistensi sidebar vs endpoint. Section yang tersembunyi di
 * sidebar tapi endpointnya boleh dipanggil menghasilkan layar yang menolak
 * permintaan sendiri; sebaliknya section yang terlihat tapi endpointnya
 * tertutup menghasilkan error yang tidak bisa dijelaskan.
 */

const APP_DIR = "src/app/api/admin";

function listRouteFiles(dir = APP_DIR): string[] {
  const found: string[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "route.ts") {
        /*
         * `src/app/api/admin/orders/route.ts` -> `/api/admin/orders`.
         *
         * Potongan yang dipakai adalah setelah `admin`: indeks 0..3 adalah
         * src, app, api, admin, jadi sisa segmen url dimulai dari 4 dan
         * nama file dibuang.
         */
        const segments = full.split("\\").slice(4, -1);
        found.push("/api/admin/" + segments.join("/"));
      }
    }
  };

  walk(dir);
  return found.sort();
}

const ROUTE_FILES = listRouteFiles();

/** Rute yang dipetakan oleh ROUTE_SCOPE, dalam bentuk pathname. */
function mappedPaths() {
  return ROUTE_SCOPE.map(([prefix]) => prefix);
}

test("sanity: pemindaian route benar-benar menemukan file", () => {
  /*
   * Tanpa test ini, test lain di file ini bisa hijau karena tidak membaca
   * apa pun - misalnya kalau folder dipindah dan glob-nya diam-diam jadi
   * tidak cocok. Jumlah di bawah sengaja dikunci supaya perpindahan
   * folder terlihat sebagai kegagalan, bukan sebagai "tidak ada yang salah".
   */
  assert.ok(
    ROUTE_FILES.length >= 45,
    `hanya ${ROUTE_FILES.length} route ditemukan - folder admin berubah tempat?`,
  );
});

test("SETIAP route punya scope atau tercatat sebagai sengaja tertutup", () => {
  /*
   * Ini test yang paling penting di file ini.
   *
   * Route yang tidak tercakup akan TERTUTUP untuk admin - perilaku yang
   * benar, tapi tidak bisa dibedakan dari route yang luput dipetakan. Tanpa
   * daftar eksplisit, "tertutup karena Predictive" dan "tertutup karena
   * lupa" akan terlihat sama forever.
   */
  const mapped = mappedPaths();
  const closed = ROUTES_INTENTIONALLY_CLOSED.map(([prefix]) => prefix);

  const uncovered = ROUTE_FILES.filter((path) => {
    if (ROUTES_WITHOUT_AUTHORIZATION.includes(path as never)) return false;
    if (closed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return false;
    }
    return !mapped.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  });

  assert.deepEqual(
    uncovered,
    [],
    `route tidak tercakup di peta, daftar tertutup, maupun pengecualian:\n  ${uncovered.join("\n  ")}`,
  );
});

test("route yang tercatat sengaja tertutup benar-benar tertutup", () => {
  for (const [path, alasan] of ROUTES_INTENTIONALLY_CLOSED) {
    assert.equal(
      routeScopeFor(path),
      null,
      `${path} punya scope di peta, tapi juga didaftarkan tertutup (${alasan})`,
    );
    assert.equal(canAccessRoute("admin", path), false, path);
  }
});

test("daftar tertutup tidak menimpa peta yang sah", () => {
  /*
   * Dua daftar ini harus saling lepas. Kalau ada route yang tercatat
   * "sengaja tertutup" padahal petanya bilang boleh, dokumennya berbohong
   * dan pemeriksa berikutnya akan percaya dokumen itu.
   */
  const closed = ROUTES_INTENTIONALLY_CLOSED.map(([prefix]) => prefix);

  for (const prefix of closed) {
    assert.equal(routeScopeFor(prefix), null, `${prefix} ada di peta DAN daftar tertutup`);
  }
});

test("route yang disebut peta benar-benar ada sebagai file", () => {
  const mapped = mappedPaths();

  const dangling = mapped.filter((prefix) => {
    const exact = ROUTE_FILES.includes(prefix);
    const prefixOnly = ROUTE_FILES.some((path) => path.startsWith(`${prefix}/`));
    return !exact && !prefixOnly;
  });

  assert.deepEqual(
    dangling,
    [],
    `prefix peta menunjuk ke url yang tidak ada:\n  ${dangling.join("\n  ")}`,
  );
});

test("test-transaction supplier keluar dari Katalog", () => {
  /*
   * Prefiks `/api/admin/digiflazz` membuka sebelas route sekaligus, dan
   * satu di antaranya bukan katalog: `test-transaction` memanggil API
   * supplier sungguhan. Di sandbox tidak berbahaya, di production ia
   * menghabiskan saldo supplier - jadi ini pekerjaan teknis dan harus
   * tertutup untuk admin.
   */
  assert.equal(routeScopeFor("/api/admin/digiflazz/test-transaction"), "alat");
  assert.equal(canAccessRoute("admin", "/api/admin/digiflazz/test-transaction"), false);
  assert.equal(canAccessRoute("superadmin", "/api/admin/digiflazz/test-transaction"), true);

  // Route katalog lain di bawah prefix yang sama tetap terbuka.
  assert.equal(routeScopeFor("/api/admin/digiflazz/sync-prices"), "katalog");
});

test("fail-closed: route tanpa peta MENOLAK admin", () => {
  // `/api/admin/users` sengaja tidak dipetakan: daftar customer adalah
  // bagian Sistem, dan admin tidak boleh membukanya.
  assert.equal(routeScopeFor("/api/admin/users"), null);
  assert.equal(canAccessRoute("admin", "/api/admin/users"), false);

  // Jalur yang tidak dikenal juga tertutup, bukan terbuka.
  assert.equal(canAccessRoute("admin", "/api/admin/apa-saja"), false);
  assert.equal(canAccessRoute("admin", "/api/admin"), false);
  assert.equal(canAccessRoute("admin", "/"), false);
});

test("fail-closed: prefix yang meleset TIDAK ikut tertangkap", () => {
  /*
   * Kalau pencocokan pakai `startsWith` tanpa batas, `/api/admin/users-lite`
   * akan ikut tertangkap prefix `/api/admin/users` - atau Sebaliknya,
   * `/api/admin/usersX` dianggap punya scope. Batas `/` itu yang mencegah.
   */
  assert.equal(routeScopeFor("/api/admin/overview-lite"), null);
  assert.equal(routeScopeFor("/api/admin/catalogX"), null);
});

test("prefiks terpanjang menang", () => {
  // `/api/admin/affiliates/link` dan `/api/admin/affiliates/withdrawals`
  // ada di grup BERBEDA dan sama-sama berawalan `/api/admin/affiliates`.
  assert.equal(routeScopeFor("/api/admin/affiliates/link"), "pertumbuhan");
  assert.equal(routeScopeFor("/api/admin/affiliates/withdrawals"), "keuangan");
});

test("prefiks menutupi seluruh route turunannya", () => {
  for (const path of [
    "/api/admin/digiflazz",
    "/api/admin/digiflazz/catalog",
    "/api/admin/digiflazz/catalog/publish",
    "/api/admin/digiflazz/sync-prices",
  ]) {
    assert.equal(routeScopeFor(path), "katalog", path);
  }

  for (const path of [
    "/api/admin/orders",
    "/api/admin/orders/abc-123",
    "/api/admin/orders/abc-123/receipt",
  ]) {
    assert.equal(routeScopeFor(path), "operasional", path);
  }
});

test("admin boleh empat grup kerja, bukan sistem dan alat", () => {
  assert.deepEqual([...allowedScopes("admin")], [
    "operasional",
    "katalog",
    "keuangan",
    "pertumbuhan",
  ]);

  assert.equal(canAccessScope("admin", "sistem"), false);
  assert.equal(canAccessScope("admin", "alat"), false);
});

test("superadmin dan legacy punya akses penuh", () => {
  for (const role of ["superadmin", "legacy"]) {
    assert.equal(hasFullAdminAccess(role), true, role);
    assert.deepEqual([...allowedScopes(role)], [...ADMIN_SCOPES], role);

    for (const scope of ADMIN_SCOPES) {
      assert.equal(canAccessScope(role, scope), true, `${role}/${scope}`);
    }

    // Termasuk route yang tidak ada di peta.
    assert.equal(canAccessRoute(role, "/api/admin/users"), true, role);
  }
});

test("role admin ditolak dari setiap route sistem dan alat", () => {
  const tertutup = [
    "/api/admin/users",
    "/api/admin/admin-users",
    "/api/admin/readiness",
    "/api/admin/operations/health",
    "/api/admin/payment-settings",
    "/api/admin/test-lab",
    "/api/admin/supplier-balance",
    "/api/admin/telegram/dispatch",
    "/api/admin/telegram/daily-digest",
    "/api/admin/telegram/test",
  ];

  for (const path of tertutup) {
    assert.equal(canAccessRoute("admin", path), false, path);
  }
});

test("role admin BOLEH empat grup yang sudah dipetakan", () => {
  const boleh = [
    "/api/admin/overview",
    "/api/admin/orders",
    "/api/admin/receipts",
    "/api/admin/transactions",
    "/api/admin/catalog",
    "/api/admin/promotions",
    "/api/admin/digiflazz/sync-prices",
    "/api/admin/melostore/catalog",
    "/api/admin/cash-flow",
    "/api/admin/finance",
    "/api/admin/reconciliation",
    "/api/admin/merchants",
    "/api/admin/merchant-payments",
    "/api/admin/affiliates/withdrawals",
    "/api/admin/points",
    "/api/admin/affiliate-performance",
    "/api/admin/affiliate-requests",
    "/api/admin/affiliates/link",
    "/api/admin/banners",
    "/api/admin/payment-methods",
  ];

  for (const path of boleh) {
    assert.equal(canAccessRoute("admin", path), true, path);
  }
});

test("pengecualian session tetap dibaca, bukanroute tanpa gerbang", () => {
  assert.ok(ROUTES_WITHOUT_AUTHORIZATION.includes("/api/admin/session" as never));
  assert.ok(ROUTE_FILES.includes("/api/admin/session"));
});

test("SETIAP section punya scope", () => {
  /*
   * Section tanpa entri akan dianggap punya scope `undefined`, yang berarti
   * `canAccessScope` menerima `undefined` dan sidebar menampilkan semua
   * orang. Test ini membuat kekosongan itu jadi failure yang terlihat.
   */
  const sections = [
    "overview", "orders", "receipts", "transactions",
    "catalog", "promotions", "supplier",
    "cashflow", "finance", "merchants",
    "points", "affiliates",
    "users", "system",
  ];

  for (const section of sections) {
    assert.ok(
      isAdminScope(SECTION_SCOPE[section]),
      `section ${section} tidak punya scope yang valid`,
    );
  }
});

test("SETIAP halaman terpisah punya scope", () => {
  for (const href of [
    "/admin/docs",
    "/admin/operations",
    "/admin/test-lab",
    "/admin/digiflazz",
    "/admin/melostore-mapping",
    "/admin/banners",
    "/admin/affiliates",
    "/admin/payment-methods",
  ]) {
    assert.ok(isAdminScope(TOOL_SCOPE[href]), `halaman ${href} tidak punya scope`);
  }
});

test("section sidebar dan endpointnya konsisten", () => {
  /*
   * Ini yang menangkap kelas bug paling yang diam: sidebar menampilkan
   * sesuatu yang endpointnya tertutup untuk role yang sama. Gejalanya
   * operator membuka halaman lalu mendapat 403 yang tidak bisa dijelaskan.
   */
  const pasangan: Array<[string, AdminScope, string]> = [
    ["cashflow", "keuangan", "/api/admin/cash-flow"],
    ["finance", "keuangan", "/api/admin/finance"],
    ["merchants", "keuangan", "/api/admin/merchants"],
    ["overview", "operasional", "/api/admin/overview"],
    ["catalog", "katalog", "/api/admin/catalog"],
    ["points", "pertumbuhan", "/api/admin/points"],
  ];

  for (const [section, scope, path] of pasangan) {
    assert.equal(SECTION_SCOPE[section], scope, section);
    assert.equal(routeScopeFor(path), scope, path);
  }
});

test("section Sistem tertutup di kedua sisi", () => {
  /*
   * `users` dan `system` punya scope `sistem` di SECTION_SCOPE, tapi
   * endpoint-nya SENGAJA tidak ada di ROUTE_SCOPE. Itu bukan kelalaian:
   * tidak dipetakan berarti tertutup untuk admin, dan itulah hasil yang
   * diinginkan. Yang diuji di sini justru konsistensi itu - section-nya
   * tersembunyi DAN endpoint-nya menutup, bukan salah satu saja.
   */
  assert.equal(SECTION_SCOPE.users, "sistem");
  assert.equal(SECTION_SCOPE.system, "sistem");

  assert.equal(routeScopeFor("/api/admin/users"), null);
  assert.equal(routeScopeFor("/api/admin/readiness"), null);

  for (const path of ["/api/admin/users", "/api/admin/readiness"]) {
    assert.equal(canAccessRoute("admin", path), false, path);
    assert.equal(canAccessRoute("superadmin", path), true, path);
  }
});

test("firstAllowedSection mengembalikan section yang boleh, bukan yang pertama", () => {
  const order = ["overview", "catalog", "cashflow", "users"] as const;
  const scopeOf = (section: (typeof order)[number]) => SECTION_SCOPE[section];

  // Admin: `overview` boleh, jadi itu yang dipilih.
  assert.equal(firstAllowedSection("admin", order, scopeOf), "overview");

  // Superadmin: sama, karena semuanya boleh.
  assert.equal(firstAllowedSection("superadmin", order, scopeOf), "overview");
});

test("firstAllowedSection melewati section yang tidak boleh", () => {
  const order = ["users", "system", "cashflow", "orders"] as const;
  const scopeOf = (section: (typeof order)[number]) => SECTION_SCOPE[section];

  // Admin tidak boleh `users`/`system`, jadi harus melompat ke `cashflow`.
  assert.equal(firstAllowedSection("admin", order, scopeOf), "cashflow");
});

test("firstAllowedSection mengembalikan null saat tidak ada yang boleh", () => {
  const order = ["users", "system"] as const;
  const scopeOf = (section: (typeof order)[number]) => SECTION_SCOPE[section];

  /*
   * Role yang tidak dikenal tidak boleh apa pun. Mengembalikan null di
   * sini penting: kalau mengembalikan section pertama, sidebar akan
   * menampilkan bagian yang tidak bisa dibuka saat session masih dimuat.
   */
  assert.equal(firstAllowedSection("", order, scopeOf), null);
  assert.equal(firstAllowedSection("admin", order, scopeOf), null);
});

test("scope string acak tidak dianggap sah", () => {
  for (const value of ["Operasional", "ADMIN", "", "katalog ", null, 42, {}]) {
    assert.equal(isAdminScope(value), false, JSON.stringify(value));
  }

  for (const value of ADMIN_SCOPES) {
    assert.equal(isAdminScope(value), true, value);
  }
});