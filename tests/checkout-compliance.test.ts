import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guard test level-source untuk P1 anti-fraud & kepatuhan pra-publik
 * (20 Okt 2026):
 *
 * - P1.1: anti self-referral by user_id — komisi referral/link ke akun
 *   sendiri adalah margin bocor murni (diskon referral + komisi dari
 *   order yang sama, dua-duanya milik orang yang sama).
 * - P1.2: anti self-referral by WhatsApp/email ternormalisasi — menutup
 *   celah "login dengan akun lain" dan tamu dengan nomor sama.
 * - P1.3: consent Syarat & Ketentuan + Kebijakan Privasi per order
 *   (UU PDP) — checkbox + timestamp di orders.
 * - P1.4: minimal pencairan komisi configurable via app_settings.
 * - Bonus: linkCode cookie kini dikirim saat pembuatan order —
 *   sebelumnya hanya di preview, jadi komisi link tidak pernah
 *   mendarat di order (jalur mati sejak awal).
 */

const repo = readFileSync("src/lib/pricing-repository.ts", "utf8");
const ordersRoute = readFileSync("src/app/api/orders/route.ts", "utf8");
const ui = readFileSync("src/components/TopupExperience.tsx", "utf8");
const affiliatePanel = readFileSync(
  "src/components/AffiliateAccountPanel.tsx",
  "utf8",
);
const withdrawalsRoute = readFileSync(
  "src/app/api/account/affiliate/withdrawals/route.ts",
  "utf8",
);
const affiliateRoute = readFileSync(
  "src/app/api/account/affiliate/route.ts",
  "utf8",
);

test("anti self-referral: user_id + kontak di pricing-repository", () => {
  assert.ok(
    repo.includes("affiliateOwnedByBuyer"),
    "pencocok identitas pemilik kode vs pembeli harus ada",
  );
  // Identitas pembeli mengalir dari orders (email/whatsapp receipt asli).
  assert.ok(repo.includes("buyerEmail"));
  assert.ok(repo.includes("buyerWhatsapp"));
  // Jalur kode manual: ditolak eksplisit.
  assert.ok(
    repo.includes("Kode referral ini milikmu sendiri"),
    "kode referral milik sendiri harus ditolak 409 dengan pesan jelas",
  );
  // Jalur link: diputus senyap, order tetap jalan.
  assert.ok(
    repo.includes("ownerUserId"),
    "pemilik kode link harus tercatat untuk dicek",
  );
});

test("orders: consent wajib + linkCode cookie + identitas pembeli", () => {
  // P1.3: order tanpa consent ditolak sebelum efek samping apa pun.
  assert.ok(ordersRoute.includes("termsAccepted"));
  assert.ok(
    ordersRoute.includes("terms_accepted_at: now"),
    "timestamp persetujuan dicatat per order (UU PDP)",
  );
  // Bonus fix: linkCode dari cookie - komisi link akhirnya mendarat.
  assert.ok(
    ordersRoute.includes("linkCode: readLinkReferralCode(request)"),
    "cookie link /r/[code] harus dikirim saat pembuatan order",
  );
  // P1.2: identitas kontak mengalir dari orders.
  assert.ok(ordersRoute.includes("buyerEmail: receiptEmail"));
  assert.ok(ordersRoute.includes("buyerWhatsapp: receiptWhatsapp"));
});

test("migrasi 058: consent + min payout configurable", () => {
  const migration = readFileSync(
    "supabase/migrations/20261020_058_p1_compliance.sql",
    "utf8",
  );
  assert.ok(migration.includes("terms_accepted_at"));
  assert.ok(migration.includes("affiliate_min_payout"));
  assert.ok(
    migration.includes("Minimal pencairan komisi"),
    "RPC harus menolak di bawah minimal dengan pesan berisi nominalnya",
  );
});

test("UI checkout: checkbox consent + link legal + tombol terkunci", () => {
  assert.ok(ui.includes("checkout-confirm-consent"));
  assert.ok(ui.includes('href="/terms"'));
  assert.ok(ui.includes('href="/privacy"'));
  assert.ok(ui.includes("termsAccepted"));
  assert.ok(
    ui.includes("Setujui dulu untuk lanjut"),
    "tombol bayar harus terkunci sampai consent dicentang",
  );
});

test("min payout: endpoint summary + UI validasi + pesan RPC diteruskan", () => {
  assert.ok(affiliateRoute.includes("readMinPayout"));
  assert.ok(affiliateRoute.includes("minPayout"));
  assert.ok(affiliatePanel.includes("Minimal pencairan komisi"));
  assert.ok(affiliatePanel.includes("!amountValid"));
  // Pesan 'Minimal pencairan...' dari RPC tidak boleh ditelan jadi
  // 'gagal dibuat' yang tidak menjelaskan apa-apa.
  assert.ok(withdrawalsRoute.includes("Pencairan gagal:"));
});

test("popup penolakan order: kode mesin + nickname di modal ringkasan (21 Okt)", () => {
  /*
   * Permintaan owner: transaksi yang ditolak karena salah ID harus
   * tampil sebagai popup, bukan cuma notice kecil di form - dan modal
   * "Periksa transaksi kamu" harus menampilkan nama akun hasil cek,
   * konfirmasi terkuat bahwa ID-nya benar sebelum bayar.
   */
  assert.ok(
    ordersRoute.includes("invalid_account"),
    "gerbang verifikasi mengirim kode mesin supaya klien bisa membedakan",
  );

  // Popup penolakan di klien dengan CTA per kode.
  assert.ok(ui.includes("rejectionPopup"));
  assert.ok(ui.includes("User ID tidak ditemukan"));
  assert.ok(ui.includes("Perbaiki User ID"));
  assert.ok(ui.includes("Pembelian tidak bisa dilanjutkan"));

  // Nama akun tampil di modal ringkasan pembayaran (bukan banner).
  const modalStart = ui.indexOf('id="checkout-confirm-title"');
  const modalEnd = ui.indexOf("checkout-confirm-totals", modalStart);
  assert.ok(modalStart > -1 && modalEnd > modalStart);
  const modal = ui.slice(modalStart, modalEnd);
  assert.ok(
    modal.includes("usernameCheck.nickname"),
    "nama akun terverifikasi harus tampil di modal ringkasan",
  );
  assert.ok(modal.includes("Nama akun"));
});
