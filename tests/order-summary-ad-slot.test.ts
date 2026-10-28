import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * P4.5 (28 Okt 2026): slot iklan kecil di order summary — kini unit
 * Google AdSense nyata (sebelumnya house-ad promo internal; swap nomor
 * SEAM didokumenkasih di plan order-summary-ad-slot.md §6).
 *
 * Yang dijaga test ini: aturan plan ditegakkan di kode, bukan cuma
 * tertulis. Slot yang melanggar batasan (popup, menutupi tombol, muncul
 * sebelum order sukses) lebih buruk daripada tidak ada slot sama sekali.
 */

test("slot hanya tampil untuk status tuntas — bukan saat pelanggan sibuk", () => {
  const view = readFileSync("src/components/OrderStatusView.tsx", "utf8");

  // Gate status dipasang di pemanggil: hanya success / awaiting_receivable.
  assert.ok(
    view.includes(
      'liveStatus === "awaiting_receivable") && <OrderSummaryAdSlot />',
    ),
    "gate status: hanya success / awaiting_receivable",
  );
  assert.ok(
    view.indexOf("!isPreview &&") <
      view.indexOf('liveStatus === "awaiting_receivable") && <OrderSummaryAdSlot'),
    "slot tidak dirender untuk preview checkout",
  );

  const ratingIndex = view.indexOf("<OrderRatingForm");
  const adIndex = view.indexOf("<OrderSummaryAdSlot />");
  assert.ok(
    ratingIndex > 0 && adIndex > ratingIndex,
    "slot di BAWAH rating form — aturan plan §1",
  );
});

test("rating form: textarea terbuka hanya setelah bintang diklik", () => {
  const form = readFileSync("src/components/OrderRatingForm.tsx", "utf8");

  assert.ok(
    form.includes("const [expanded, setExpanded] = useState(false);"),
    "state expanded mulai tertutup",
  );
  // Klik bintang membuka form (dan ganti bintang tidak menutupnya lagi).
  const starClick = form.match(
    /onClick=\{\(\) => \{\s*\n\s*setRating\(value\);\s*\n\s*setExpanded\(true\);/,
  );
  assert.ok(starClick, "klik bintang sekaligus membuka form");

  // Ulasan lama tampil ringkas dulu + tombol ubah.
  assert.ok(
    form.includes('className="order-rating-expand"'),
    "tombol Ubah ulasan untuk membuka ulasan lama",
  );
  // Tiga keadaan yang benar (versi pertama ternary-nya terbalik):
  // form penuh SAAT showCommentForm, tombol ubah SAAT submitted,
  // dan TIDAK ADA yang tampil untuk ulasan baru yang belum dibuka.
  assert.ok(
    form.includes("showCommentForm ? (") && form.includes(") : submitted ? ("),
    "form penuh hanya saat terbuka; ulasan lama dapat tombol ubah; baru = hanya bintang",
  );
});

test("adsense: unit env-gated, loader ber-nonce, ads.txt terpasang", () => {
  const slot = readFileSync("src/components/OrderSummaryAdSlot.tsx", "utf8");
  const loader = readFileSync("src/components/AdSenseScript.tsx", "utf8");
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const adsTxt = readFileSync("public/ads.txt", "utf8");

  // Slot tidak dirender kecuali env lengkap — request iklan dengan
  // client/slot kosong hanya menghasilkan error di console pelanggan.
  assert.ok(
    slot.includes("if (!adClient || !adSlot) return null;"),
    "senyap tanpa env AdSense lengkap",
  );
  assert.ok(
    slot.includes("data-ad-client={adClient}") &&
      slot.includes("data-ad-slot={adSlot}"),
    "unit mengambil client/slot dari env",
  );

  // Loader: satu script di root layout, env-gated, ber-nonce (CSP
  // production 'strict-dynamic' mengabaikan allowlist host — lihat
  // tests/csp.test.ts).
  assert.ok(
    loader.includes("NEXT_PUBLIC_ADSENSE_CLIENT"),
    "loader env-gated",
  );
  assert.ok(
    loader.includes('headers()).get("x-nonce"'),
    "nonce diambil dari header x-nonce middleware",
  );
  assert.ok(loader.includes("nonce="), "script dimuat dengan nonce");
  assert.ok(
    layout.includes("<AdSenseScript />"),
    "loader dipasang sekali di root layout",
  );

  // ads.txt di root domain — syarat peninjauan AdSense.
  assert.ok(
    adsTxt.includes(
      "google.com, pub-8909235410345672, DIRECT, f08c47fec0942fa0",
    ),
    "baris authorized seller AdSense ada di ads.txt",
  );
});

test("CSS menegakkan batasan plan: kecil, terbatas, tidak menutupi", () => {
  const css = readFileSync("src/app/order.css", "utf8");

  const adMatch = css.match(/\.order-summary-ad \{[\s\S]*?\n\}/);
  assert.ok(adMatch, "gaya .order-summary-ad harus terbaca");
  assert.ok(adMatch[0].includes("max-height: 120px;"), "tinggi dibatasi 120px");
  assert.ok(adMatch[0].includes("overflow: hidden;"), "overflow terpotong, tidak melebar");
  assert.ok(
    adMatch[0].includes("border-top: 1px solid"),
    "pemisah tipis — bukan blok yang menyolok",
  );
});
