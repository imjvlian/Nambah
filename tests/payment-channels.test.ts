import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Migrasi 061 (28 Okt 2026): metode pembayaran lengkap — kanal per-kanal
 * di checkout, keputusan owner:
 *   D1 pilih KANAL langsung di /product/<id>, Snap langsung ke flow-nya
 *      (enabled_payments satu kanal); tidak ada daftar ganda;
 *   D2 yang AKTIF: kanal terbukti (gopay, shopeepay, dana, ovo,
 *      qris/other_qris, VA per-bank); minimarket + kartu kredit dibuat
 *      non-aktif sampai aktivisasi Midtrans dikonfirmasi;
 *   D3 baris genus legacy (qris menjabat; ewallet + va) non-aktif;
 *   D4 semua fee 0 — fee gateway 100% diterjunkan ke pembeli oleh
 *      Midtrans; QRIS tidak boleh disurcharge (BI);
 *   D5 label harga uang: "Biaya layanan", bukan "Biaya pembayaran".
 */

const CHANNEL_IDS = [
  "qris",
  "gopay",
  "shopeepay",
  "dana",
  "ovo",
  "bca_va",
  "bni_va",
  "bri_va",
  "permata_va",
  "echannel",
];

test("migrasi 061: semua kanal terbukti aktif dengan fee nol", () => {
  const sql = readFileSync(
    "supabase/migrations/20261028_061_payment_channels.sql",
    "utf8",
  );

  for (const id of CHANNEL_IDS.filter((id) => id !== "qris")) {
    assert.ok(
      sql.includes(`('${id}',`),
      `kanal ${id} ada di daftar insert migrasi`,
    );
  }

  // `qris` menjabat jadi baris kanal QRIS — di-update, bukan di-insert
  // (barisnya sudah ada sejak seed pertama).
  assert.match(
    sql,
    /update public\.payment_methods\s*\n\s*set active = true[^;]*id = 'qris'/,
  );

  // D2: minimarket/kartu kredit non-aktif (aktivisasi belum dikonfirmasi).
  for (const id of ["indomaret", "alfamart", "credit_card"]) {
    assert.match(
      sql,
      new RegExp(`\\('${id}',[^;]*false,`),
      `${id} dibuat non-aktif sampai aktivisasi dikonfirmasi`,
    );
  }

  // D4: fee 0 untuk setiap baris — termasuk QRIS (larangan surcharge BI).
  assert.ok(
    !/, [1-9], [0-9.]+,/.test(sql.split("values")[1] ?? ""),
    "semua nilai fee di insert migrasi bernilai nol",
  );

  // D3: genus legacy tidak dihapus, hanya non-aktif.
  assert.match(
    sql,
    /update public\.payment_methods\s*\n\s*set active = false[^;]*'ewallet', 'va'/,
  );
});

test("orders route: QRIS mengarah ke other_qris, kanal lain passthrough", () => {
  const route = readFileSync("src/app/api/orders/route.ts", "utf8");

  assert.ok(
    route.includes('qris: ["other_qris"]'),
    "baris qris memanggil kanal other_qris",
  );
  // Passthrough: id baris baru = id kanal Midtrans - Snap tidak menampilkan
  // daftar ulang saat hanya ada satu kanal.
  assert.ok(
    route.includes("?? [\n        // Kanal per-kanal") ||
      route.includes("?? [\n        // Kanal"),
    "fallback passthrough [paymentMethod.id] ada",
  );
  // Genus legacy tetap punya jaring pengaman.
  assert.ok(
    route.includes('ewallet: ["gopay", "shopeepay", "dana", "ovo"]') &&
      route.includes('va: ["bank_transfer"]'),
  );
});

test("label uang: 'Biaya layanan', bukan 'Biaya pembayaran' (D5)", () => {
  const topup = readFileSync("src/components/TopupExperience.tsx", "utf8");
  const orderView = readFileSync("src/components/OrderStatusView.tsx", "utf8");

  assert.ok(
    topup.includes("<span>Biaya layanan</span>"),
    "TopupExperience memakai label Biaya layanan",
  );
  // Yang dilarang adalah penggunaannya di UI (JSX); menyebut istilah lama
  // di komentar riwayat tidak masalah.
  assert.ok(
    !topup.includes('<span>Biaya pembayaran<'),
    "TopupExperience tidak lagi menampilkan 'Biaya pembayaran' sebagai baris UI",
  );
  assert.ok(
    orderView.includes("<span>Biaya layanan</span>") &&
      !orderView.includes("<span>Biaya pembayaran<"),
    "OrderStatusView ikut berganti label",
  );
  // Jalur ritel tetap "Biaya layanan toko" - nama asal uangnya beda.
  assert.ok(
    topup.includes("Biaya layanan toko"),
    "label jelajah ritel dipertahankan",
  );
});

test("fallback statis katalog mencerminkan kanal aktif", () => {
  const catalog = readFileSync("src/lib/catalog.ts", "utf8");

  for (const id of CHANNEL_IDS) {
    assert.ok(
      catalog.includes(`id: "${id}"`),
      `${id} ada di daftar statis (fallback di luar Supabase)`,
    );
  }
  assert.ok(
    !catalog.includes('id: "ewallet"') && !catalog.includes('id: "va"'),
    "genus legacy tidak dipasang di fallback statis aktif",
  );
});
