import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  groupPaymentMethods,
  paymentGroupOf,
} from "@/lib/payment-method-groups";

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

test("grup kartu: QRIS / E-Wallet / Virtual Account, urut stabil", () => {
  const groups = groupPaymentMethods([
    { id: "bri_va" },
    { id: "ovo" },
    { id: "qris" },
    { id: "gopay" },
    { id: "echannel" },
    { id: "permata_va" },
  ]);

  assert.deepEqual(
    groups.map((group) => group.label),
    ["QRIS", "E-Wallet", "Virtual Account"],
  );
  assert.deepEqual(
    groups[2].methods.map((method) => method.id),
    ["bri_va", "echannel", "permata_va"],
    "urutan dalam grup mengikuti urutan DB (sort_order)",
  );
  // Kanal di luar konvensi tidak hilang.
  assert.deepEqual(
    groupPaymentMethods([{ id: "mandiri_qris" }])[0].label,
    "Lainnya",
  );
});

test("UI kartu grup: struktur payment-group/grid/card + icon per kanal", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  const icon = readFileSync("src/components/PaymentMethodIcon.tsx", "utf8");

  assert.ok(
    ui.includes("groupPaymentMethods(paymentMethods)"),
    "daftar DB dikelompokkan lewat helper",
  );
  assert.ok(
    ui.includes('className="payment-group"') &&
      ui.includes('className="payment-grid"') &&
      ui.includes('className="payment-card'),
    "grup > grid > kartu dirender di checkout",
  );
  assert.ok(
    ui.includes("<PaymentMethodIcon id={method.id} />"),
    "tiap kanal memuat icon logonya",
  );
  // Radio tetap: nilai & handler setPaymentId supaya pilihan ikut ke order.
  assert.match(ui, /value=\{method\.id\}/);
  assert.match(ui, /onChange=\{\(\) => setPaymentId\(method\.id\)\}/);

  // Aset logo tiap kanal AKTIF terpasang di komponen ikon (path aset ada
  // di LOGO_ASSETS); fallback chip tetap tersedia untuk kanal tanpa aset.
  for (const [id, asset] of [
    ["qris", "/product-assets/brands/qris.svg"],
    ["gopay", "/product-assets/brands/go-pay.svg"],
    ["shopeepay", "/product-assets/brands/shopee-pay.svg"],
    ["dana", "/product-assets/brands/dana.svg"],
    ["ovo", "/product-assets/brands/ovo.svg"],
    ["bca_va", "/product-assets/brands/bca.png"],
    ["bni_va", "/product-assets/brands/bni.svg"],
    ["bri_va", "/product-assets/brands/bri.svg"],
    ["permata_va", "/product-assets/brands/permata.svg"],
    ["echannel", "/product-assets/brands/mandiri.svg"],
  ] as const) {
    assert.ok(
      icon.includes(asset),
      `entri ikon ${id} ada di LOGO_ASSETS`,
    );
    assert.ok(
      readFileSync(`public${asset}`, "utf8").length > 0,
      `aset ${asset} ada di repo`,
    );
  }
});

test("pilihan awal otomatis ke QRIS (default selection)", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  assert.match(
    ui,
    /paymentMethods\.find\(\(method\) => method\.id === "qris"\)/,
    "default pilihan disetel ke qris, tidak hanya barang pertama dalam array",
  );
});

test("grup collapse secara default; state openGroups awal kosong", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  assert.ok(
    ui.includes("useState<Set<string>>(new Set())"),
    "state grup terbuka dimulai kosong (semua grup collapse)",
  );
  assert.ok(
    ui.includes("aria-expanded={isGroupOpen(group.label)}"),
    "label grup berfungsi sebagai tombol toggle collapse",
  );
});

test("grup: tanpa garis pemisah tambahan (kotak grup + border cukup)", () => {
  const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
  const css = readFileSync("src/app/product-checkout-rail-v2.css", "utf8");

  assert.ok(
    !ui.includes("payment-group-divider"),
    "elemen garis pemisah tidak lagi dirender di checkout",
  );
  assert.ok(
    !css.includes(".payment-group-divider"),
    "style garis pemisah dihapus",
  );
});

test("grup collapsed: label & panah vertikal center (tanpa margin bawah label)", () => {
  const rawCss = readFileSync("src/app/product-checkout-rail-v2.css", "utf8");
  // Komentar CSS dibuang dulu: komentar boleh menyebut contoh rule lama
  // (mis. `margin: 0 0 7px`) sebagai dokumentasi.
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

  // Label TIDAK boleh punya margin bawah: di dalam baris flex, margin bawah
  // ikut dihitung alignment sehingga teks terdorong ke atas dan tidak
  // sejajar dengan panah.
  const labelBlocks = css.match(
    /\.payment-group-label \{[^}]*\}/g,
  );
  assert.ok(labelBlocks && labelBlocks.length >= 1, "ada blok label grup");
  for (const block of labelBlocks) {
    assert.ok(
      /margin:\s*0(;|\s)/.test(block) && !/margin:\s*0 0 \d/.test(block),
      `label grup tidak punya margin bawah: ${block.replace(/\s+/g, " ")}`,
    );
  }

  // Baris toggle harus flex + align-items center.
  const toggle = css.match(/\.payment-group-toggle \{[^}]*\}/)?.[0] ?? "";
  assert.match(toggle, /display:\s*flex/);
  assert.match(toggle, /align-items:\s*center/);

  // Jarak ke grid diurus .payment-grid, bukan margin label. Setidaknya
  // satu blok .payment-grid harus punya margin-top.
  const gridBlocks = css.match(/\.payment-grid \{[^}]*\}/g) ?? [];
  assert.ok(
    gridBlocks.some((block) => /margin-top:\s*\d+px/.test(block)),
    "jarak label ke kartu diurus margin-top .payment-grid",
  );
});

test("rail: tetap bisa digulir tapi scrollbar-nya disembunyikan", () => {
  const css = readFileSync("src/app/product-checkout-rail-v2.css", "utf8");

  const railBlock = css.match(
    /\.product-page \.order-card > \.checkout-rail \{[^}]*\}/,
  )?.[0];
  assert.ok(railBlock, "blok .checkout-rail ada");

  // Tetap scrollable.
  assert.match(railBlock, /overflow:\s*auto/);
  assert.match(railBlock, /max-height:\s*calc\(/);

  // Scrollbar disembunyikan - dua-duanya (Firefox/Chrome modern + WebKit).
  assert.match(
    railBlock,
    /scrollbar-width:\s*none/,
    "scrollbar-width: none hides the bar in Firefox/Chrome 121+",
  );
  assert.ok(
    css.includes(
      ".product-page .order-card > .checkout-rail::-webkit-scrollbar",
    ),
    "::-webkit-scrollbar hides the bar in Safari/older Chrome",
  );
});

test("rail CSS: aturan direct-child yang sudah mati dibersihkan", () => {
  const css = readFileSync("src/app/product-checkout-rail-v2.css", "utf8");

  // Payment block / pricing summary / CTA kini hidup di dalam
  // .checkout-rail, jadi selector direct-child .order-card > ... tidak
  // pernah cocok dan hanya jadi jebakan.
  for (const dead of [
    ".order-card > .form-block:has(.payment-grid)",
    ".order-card > .pricing-summary",
    ".order-card > .primary-button.full",
  ]) {
    assert.ok(
      !css.includes(dead),
      `aturan mati dibersihkan: ${dead}`,
    );
  }

  // Yang masih hidup harus tetap ada.
  assert.ok(
    css.includes(".order-card > .checkout-rail"),
    "container .checkout-rail tetap diatur",
  );
  assert.ok(
    css.includes(".order-card > .form-notice"),
    "form-notice (masih anak langsung) tetap diatur",
  );
});

test("grup legacy: ewallet & va masuk grup yang wajar, bukan 'Lainnya'", () => {
  assert.equal(paymentGroupOf("ewallet"), "E-Wallet");
  assert.equal(paymentGroupOf("va"), "Virtual Account");
  // Kanal per-kanal tetap seperti semula.
  assert.equal(paymentGroupOf("qris"), "QRIS");
  assert.equal(paymentGroupOf("gopay"), "E-Wallet");
  assert.equal(paymentGroupOf("bca_va"), "Virtual Account");
  assert.equal(paymentGroupOf("echannel"), "Virtual Account");
  assert.equal(paymentGroupOf("indomaret"), "Minimarket");
});
