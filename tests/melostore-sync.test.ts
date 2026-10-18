import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guard test level-source untuk keselarasan katalog Melostore (18 Okt
 * 2026). Katalog nyata 21.947 SKU vs cap lama 10.000 (20 halaman x 500):
 * lebih dari separuh katalog tidak pernah sampai ke cache Nambah, dan
 * scan-nya tercatat "success" - sukses palsu yang membuat produk seperti
 * mlidemb-s1 tidak pernah muncul di admin.
 */

test("cap halaman scan cukup untuk katalog nyata + potongan jujur", () => {
  const client = readFileSync("src/lib/suppliers/melostore-client.ts", "utf8");
  assert.ok(
    client.includes("MAX_PAGES = 60"),
    "cap harus 60 halaman (30.000 SKU) - katalog nyata 21.947 = 44 halaman",
  );
  assert.ok(
    client.includes("PAGE_DELAY_MS"),
    "pacing antar halaman wajib - 44 halaman beruntun melebihi 20 req/menit",
  );
  assert.ok(client.includes("truncated"), "potongan cap harus terdeteksi");

  const route = readFileSync(
    "src/app/api/admin/digiflazz/melostore-sync/route.ts",
    "utf8",
  );
  assert.ok(
    route.includes("hasil.truncated"),
    "scan terpotong wajib berstatus partial, bukan sukses palsu",
  );
});

test("maintenance terjadwal: cron route + timer systemd", () => {
  const cronRoute = readFileSync(
    "src/app/api/cron/melostore-maintenance/route.ts",
    "utf8",
  );
  assert.ok(cronRoute.includes("authorizeCronRequest("));
  assert.ok(cronRoute.includes("maintenance=1"));

  const timers = readFileSync("deploy/systemd/install-timers.sh", "utf8");
  assert.ok(timers.includes("melostore-maintenance"));
});

test("cron harga membaca cache terfilter - bukan menarik katalog live", () => {
  const lib = readFileSync("src/lib/supplier-price-sync.ts", "utf8");
  assert.ok(lib.includes("bacaHargaMelostoreDariCache"));
  assert.ok(
    !lib.includes("fetchQuotes"),
    "melostore tidak boleh menarik katalog live (44 halaman/jam) lagi",
  );
  assert.ok(lib.includes("riwayatScan"), "usia cache wajib diperiksa");

  const syncRoute = readFileSync(
    "src/app/api/admin/digiflazz/melostore-sync/route.ts",
    "utf8",
  );
  assert.ok(syncRoute.includes("bacaHargaMelostoreDariCache"));
  assert.ok(!syncRoute.includes("client.fetchQuotes()"));
});

test("pencarian SKU server-side; katalog utuh berhenti dikirim ke browser", () => {
  const route = readFileSync(
    "src/app/api/admin/digiflazz/melostore-mapping/route.ts",
    "utf8",
  );
  assert.ok(route.includes("cariSku"));
  assert.ok(
    route.includes("gameCocokUntukProduk"),
    "saringan game tetap dijaga server - pencarian bukan pintu masuk game salah",
  );
  assert.ok(
    !route.includes("melostore: meloCatalog.map"),
    "options.melostore tidak boleh berisi katalog penuh (21.947 SKU) lagi",
  );

  const ui = readFileSync("src/components/AdminDashboard.tsx", "utf8");
  assert.ok(ui.includes("cariSku"), "dropdown memakai pencarian server");
  assert.ok(
    !ui.includes("urutkanKandidatMelostore"),
    "pindai katalog penuh di sisi client dihapus",
  );
});
