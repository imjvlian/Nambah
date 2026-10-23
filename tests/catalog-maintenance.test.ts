import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * P3.1 (23 Okt 2026): maintenance mode per SKU / per game.
 *
 * Masalah yang ditutup: etalase menampilkan produk yang tidak bisa
 * dibeli — pelanggan membayar dulu, gagal saat fulfillment, lalu masuk
 * loop refund. Fix-nya dua lapis: etalase menyembunyikan item
 * maintenance, dan gate order menolak sisanya (halaman ke-cache di
 * browser pelanggan).
 *
 * Keputusan penting yang dijaga test ini: `maintenance` TERPISAH dari
 * `active` — active dimiliki sinkronisasi katalog supplier, maintenance
 * dimiliki admin murni. Satu flag untuk keduanya berarti scan bisa
 * menimpa keputusan manual admin, atau sebaliknya.
 */

test("migrasi 061: kolom maintenance additive di games + products", () => {
  const migration = readFileSync(
    "supabase/migrations/20261023_061_catalog_maintenance.sql",
    "utf8",
  );

  assert.match(
    migration,
    /alter table public\.games\s+add column if not exists maintenance boolean not null default false/,
    "games.maintenance harus ada",
  );
  assert.match(
    migration,
    /alter table public\.products\s+add column if not exists maintenance boolean not null default false/,
    "products.maintenance harus ada",
  );
});

test("etalase menyembunyikan item maintenance - SKU dan game", () => {
  const repository = readFileSync("src/lib/catalog-repository.ts", "utf8");

  assert.ok(
    repository.includes("maintenanceGameIds"),
    "flag game maintenance harus dibaca",
  );

  const filterMatch = repository.match(
    /product\.game_id === game\.id &&\s*\n\s*!maintenanceGameIds\.has\(game\.id\) &&\s*\n\s*!product\.maintenance &&/,
  );
  assert.ok(
    filterMatch,
    "filter paket harus mengecualikan game maintenance DAN SKU maintenance",
  );

  // Game yang semua SKU-nya tersembunyi otomatis hilang lewat filter
  // packages.length yang sudah ada - pastikan filter itu tetap ada.
  assert.ok(
    repository.includes(".filter((game) => game.packages.length > 0)"),
    "game tanpa paket terlihat harus tetap hilang dari daftar",
  );
});

test("pricing context membawa flag maintenance produk ke gate order", () => {
  const repository = readFileSync("src/lib/pricing-repository.ts", "utf8");

  assert.ok(
    repository.includes("productMaintenance: boolean"),
    "PricingContext harus memuat productMaintenance",
  );
  assert.ok(
    repository.includes("productMaintenance: Boolean(product.maintenance)"),
    "jalur supabase membaca flag dari baris produk",
  );
  assert.ok(
    repository.includes("productMaintenance: false"),
    "jalur static fallback tidak pernah maintenance",
  );
});

test("gate order menolak maintenance SEBELUM pembayaran dengan pesan jujur", () => {
  const route = readFileSync("src/app/api/orders/route.ts", "utf8");

  const gateMatch = route.match(
    /gameConfig\.maintenance \|\| pricingContext\.context\.productMaintenance/,
  );
  assert.ok(
    gateMatch,
    "gate harus menggabungkan flag game DAN flag SKU",
  );
  assert.ok(
    route.includes(
      "Produk ini sedang tidak tersedia sementara karena perbaikan. Silakan coba lagi beberapa saat lagi.",
    ),
    "pesan penolakan jujur tanpa jargon internal",
  );

  // Gate harus terjadi SEBELUM validasi akun dan pembuatan order.
  // indexOf("validateGameAccountTarget") polos akan menangkap baris
  // IMPORT di atas file — pakai situs panggilnya.
  const gateIndex = route.indexOf(
    "gameConfig.maintenance || pricingContext.context.productMaintenance",
  );
  const insertIndex = route.indexOf('supabaseInsert("orders"');
  const accountIndex = route.indexOf(
    "const account = validateGameAccountTarget(",
  );
  assert.ok(
    gateIndex > 0 && accountIndex > gateIndex,
    "gate maintenance sebelum validasi akun - tidak ada kerja sia-sia",
  );
  assert.ok(
    insertIndex > gateIndex,
    "gate sebelum insert order - tidak ada order untuk item maintenance",
  );
});

test("admin PATCH produk: maintenance terpisah dari active", () => {
  const route = readFileSync("src/app/api/admin/catalog/[id]/route.ts", "utf8");

  assert.ok(
    route.includes("body.maintenance === undefined"),
    "maintenance opsional - PATCH lain tidak menyentuhnya",
  );
  assert.ok(
    route.includes("maintenance: nextMaintenance"),
    "nilai maintenance ikut ditulis",
  );
  assert.ok(
    route.includes("maintenance: {\n          from: existing.maintenance,"),
    "audit mencatat perubahan maintenance (from/to)",
  );
});

test("route admin game: toggle satu klik dengan validasi + audit", () => {
  const route = readFileSync("src/app/api/admin/games/[id]/route.ts", "utf8");

  assert.ok(
    route.includes("authorizeAdminRequest"),
    "gerbang admin wajib",
  );
  assert.ok(
    route.includes('typeof body.maintenance !== "boolean"'),
    "hanya menerima boolean - bukan nilai truthy apa pun",
  );
  assert.ok(
    route.includes("catalog.game.maintenance"),
    "aksi tercatat di audit admin",
  );
});

test("panel admin: toggle langsung, bukan lewat draft", () => {
  const dashboard = readFileSync("src/components/AdminDashboard.tsx", "utf8");

  assert.ok(
    dashboard.includes("async function toggleMaintenanceProduk"),
    "fungsi toggle SKU harus ada",
  );
  assert.ok(
    dashboard.includes("async function toggleMaintenanceGame"),
    "fungsi toggle game harus ada",
  );

  // Aksi LANGSUNG: PATCH maintenance saja, tanpa field draft lain yang
  // bisa ikut tersimpan tidak sengaja.
  const productToggleMatch = dashboard.match(
    /toggleMaintenanceProduk\(product: CatalogProduct\)[\s\S]*?body: JSON\.stringify\(\{ maintenance: !product\.maintenance \}\)/,
  );
  assert.ok(
    productToggleMatch,
    "toggle SKU mengirim HANYA field maintenance",
  );

  const gameToggleMatch = dashboard.match(
    /toggleMaintenanceGame\(gameId: string\)[\s\S]*?body: JSON\.stringify\(\{ maintenance: !game\.maintenance \}\)/,
  );
  assert.ok(
    gameToggleMatch,
    "toggle game mengirim HANYA field maintenance",
  );

  assert.ok(
    dashboard.includes("Maintenance semua SKU game ini"),
    "tombol maintenance game tampil di filter bar",
  );
  assert.ok(
    dashboard.includes('busy === `maintenance:${product.id}`'),
    "tombol per-baris menunjukkan state dan tidak bisa dobel-klik",
  );
});
