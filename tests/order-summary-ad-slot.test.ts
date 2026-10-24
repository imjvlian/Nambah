import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * P4.5 (24 Okt 2026): slot promosi kecil di order summary — versi
 * house-ad. Desain lengkap: plan order-summary-ad-slot.md.
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
  assert.ok(
    form.includes("submitted && !showCommentForm"),
    "ulangan terkirim tampil ringkas sampai dibuka",
  );
});

test("house-ad: konten nyata, senyap saat tidak ada promo, seam AdSense jelas", () => {
  const slot = readFileSync("src/components/OrderSummaryAdSlot.tsx", "utf8");
  const api = readFileSync("src/app/api/promo/route.ts", "utf8");

  // Sumber data: endpoint publik yang sama dengan halaman /promo.
  assert.ok(slot.includes('fetch("/api/promo"'), "slot mengambil dari /api/promo");
  assert.ok(
    api.includes("getActivePromotions()"),
    "endpoint memakai lib yang sama dengan halaman /promo",
  );

  // Tanpa promo aktif, slot TIDAK dirender — banner kosong = gangguan.
  assert.ok(
    slot.includes("if (!loaded || !promo) return null;"),
    "senyap saat tidak ada promo",
  );

  // Konten house-ad: promo pertama + kode salin + link daftar lengkap.
  assert.ok(slot.includes("CopyButton"), "kode bisa disalin langsung");
  assert.ok(slot.includes('href="/promo"'), "tautan ke daftar promo");

  // Seam AdSense ditandai eksplisit supaya swap-nya kelak tidak
  // menyentuh aturan status/gate di pemanggil.
  assert.ok(
    slot.includes("SEAM ADSENSE"),
    "penanda seam AdSense harus ada",
  );

  // Kegagalan fetch promo senyap — pelanggan yang baru selesai bayar
  // tidak perlu tahu banner gagal dimuat.
  assert.ok(
    slot.includes("} catch {"),
    "galat fetch ditelan dengan sadar (banner opsional)",
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
