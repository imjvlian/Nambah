import assert from "node:assert/strict";
import test from "node:test";

import {
  AFFILIATE_COOLDOWN_HOURS,
  conversionRate,
  cooldownRemainingMs,
  evaluateCooldown,
  remainingHours,
  triggersCooldown,
} from "../src/lib/affiliate-attribution.ts";

/**
 * Atribusi affiliate dan cooldown 24 jam.
 *
 * Aturan yang diuji di sini berasal dari keputusan pemilik produk:
 *
 *   - cooldown 24 jam, dihitung bergulir — bukan per hari kalender
 *   - hanya order `success` yang memicu
 *   - affiliate berbeda dihitung dua-duanya
 *   - affiliate sama lewat kode lain TIDAK dihitung
 *   - Beli kedua tetap boleh, yang nol hanya komisinya
 *   - kode yang diketik manual menang atas kode dari cookie link
 */

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("hanya order success yang memicu cooldown", () => {
  assert.equal(triggersCooldown("success"), true);
  // `pending_payment` bisa menggantung lalu dibatalkan. Kalau ikut menghitung,
  // affiliate bisa memblokir cooldown-nya dengan order yang tak pernah dibayar.
  for (const status of [
    "pending_payment",
    "paid",
    "processing",
    "failed",
    "cancelled",
    "refunded",
  ]) {
    assert.equal(triggersCooldown(status), false, `${status} tidak boleh memicu`);
  }
});

test("order yang dibatalkan di masa lalu tidak jadi acuan cooldown", () => {
  // Aturan "order batal tidak memicu" berlaku untuk order LAMA yang dicari
  // pemanggil, bukan untuk order yang sedang dinilai. Yang dicari hanya order
  // `success` — kuerinya di `affiliate_cooldown_active` yang menyaring itu.
  //
  // Yang bisa diuji di sini: kalau satu-satunya order lama adalah yang
  // dibatalkan, pemanggil tidak akan pernah meneruskan `created_at`-nya, jadi
  // fungsi menerima `null` dan tidak memblokir. Order `success` berikutnya
  // tetap bisa dapat komisi.
  const result = evaluateCooldown({
    affiliateCode: "JIKIWA",
    orderStatus: "success",
    // `null` = tidak ada order `success` sebelumnya. Order `cancelled` tidak
    // pernah masuk ke sini.
    lastCommissionedAt: null,
    now: NOW,
  });
  assert.equal(result.blocked, false, "order batal lama tidak boleh memblokir order baru");
});

test("order yang sedang dinilai bukan success tidak diblokir", () => {
  // Kebalikan dari test di atas: kalau order yang sedang dinilai sendiri
  // berstatus `cancelled`, komisinya memang nol karena order batal, bukan
  // karena cooldown. Bedanya penting untuk pesan ke user.
  const result = evaluateCooldown({
    affiliateCode: "JIKIWA",
    orderStatus: "cancelled",
    lastCommissionedAt: ago(2 * HOUR),
    now: NOW,
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, null, "bukan cooldown — order-nya sendiri yang batal");
});

test("beli kedua dalam 24 jam dari affiliate sama: komisi nol, beli tetap boleh", () => {
  const result = evaluateCooldown({
    affiliateCode: "JIKIWA",
    orderStatus: "success",
    lastCommissionedAt: ago(3 * HOUR),
    now: NOW,
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "cooldown");

  if (result.blocked) {
    assert.equal(result.affiliateCode, "JIKIWA");
    // Sisa ~21 jam. Yang penting: tidak nol.
    assert.ok(result.remainingMs > 0, "sisa cooldown harus positif");
    assert.ok(
      result.remainingMs < AFFILIATE_COOLDOWN_HOURS * HOUR,
      "sisa cooldown tidak boleh melebihi jendela penuh",
    );
  }
});

test("affiliate berbeda dihitung dua-duanya", () => {
  // Ini kasus A dari keputusan: user sudah Beli lewat JIKIWA, lalu Beli lewat
  // LAIN. Dua affiliate berbeda, jadi keduanya berhak komisi. Kalau yang
  // ter-scope hanya affiliate terakhir, affiliate yang pertama kehilangan
  // komisi yang sudah haknya.
  const result = evaluateCooldown({
    affiliateCode: "LAIN",
    orderStatus: "success",
    // `lastCommissionedAt` di-hit dari order LAIN sendiri, bukan affiliate lain.
    lastCommissionedAt: null,
    now: NOW,
  });
  assert.equal(result.blocked, false, "affiliate berbeda tidak boleh diblokir");
});

test("affiliate sama lewat kode lain tetap kena cooldown", () => {
  // Pemanggil harus sudah menerjemahkan kode ke affiliate induk sebelum
  // memanggil fungsi ini. Test ini mengunci kontraknya: kalau
  // `lastCommissionedAt` berasal dari affiliate yang sama, kode baru tidak lolos.
  //
  // Artinya, kalau JIKIWA punya kode JIKIWA2 dan user sudah Beli lewat
  // JIKIWA, maka Beli lewat JIKIWA2 juga diblokir — asalkan pemanggil
  // meneruskan kode yang menunjuk affiliate yang sama.
  const result = evaluateCooldown({
    affiliateCode: "JIKIWA2",
    orderStatus: "success",
    lastCommissionedAt: ago(1 * HOUR),
    now: NOW,
  });
  assert.equal(result.blocked, true, "kode baru dari affiliate sama harus diblokir");
});

test("order pending dari affiliate sama tidak diblokir", () => {
  // Order yang sedang jalan belum menghasilkan komisi. Kalau diblokir, affiliate
  // yang sedang menunggu pembayaran pertama akan terkunci untuk order kedua.
  const result = evaluateCooldown({
    affiliateCode: "JIKIWA",
    orderStatus: "pending_payment",
    lastCommissionedAt: ago(1 * HOUR),
    now: NOW,
  });
  assert.equal(result.blocked, false, "order yang belum jadi komisi tidak memblokir");
});

test("cooldown berakhir tepat setelah 24 jam", () => {
  // 23 jam 59 menit: masih aktif.
  const almost = evaluateCooldown({
    affiliateCode: "JIKIWA",
    orderStatus: "success",
    lastCommissionedAt: ago(24 * HOUR - 60_000),
    now: NOW,
  });
  assert.equal(almost.blocked, true, "23j59m masih dalam cooldown");

  // Tepat 24 jam: sudah habis. Ini "bergulir", bukan per hari kalender —
  // Beli 23:50 lalu lagi 00:10 = 20 menit, masih cooldown. Beli 08:00 lalu lagi
  // Besok 08:01 = 24 jam 1 menit, sudah boleh.
  const expired = evaluateCooldown({
    affiliateCode: "JIKIWA",
    orderStatus: "success",
    lastCommissionedAt: ago(24 * HOUR),
    now: NOW,
  });
  assert.equal(expired.blocked, false, "tepat 24 jam harus sudah boleh");
});

test("tidak ada order sebelumnya berarti tidak ada cooldown", () => {
  for (const last of [null, undefined, ""]) {
    const result = evaluateCooldown({
      affiliateCode: "JIKIWA",
      orderStatus: "success",
      lastCommissionedAt: last,
      now: NOW,
    });
    assert.equal(result.blocked, false, `lastCommissionedAt=${JSON.stringify(last)}`);
  }
});

test("waktu rusak tidak mengunci user selamanya", () => {
  // Kalau `created_at` korup, `cooldownRemainingMs` harus mengembalikan 0 —
  // bukan NaN, yang akan membuat perbandingan selalu false dan memblokir
  // semua order affiliate.
  assert.equal(cooldownRemainingMs("bukan tanggal", NOW), 0);
  assert.equal(cooldownRemainingMs("", NOW), 0);
  assert.equal(cooldownRemainingMs(null, NOW), 0);

  const result = evaluateCooldown({
    affiliateCode: "JIKIWA",
    orderStatus: "success",
    lastCommissionedAt: "bukan tanggal",
    now: NOW,
  });
  assert.equal(result.blocked, false, "waktu rusak tidak boleh memblokir");
});

test("waktu di masa depan tidak memberi cooldown negatif", () => {
  // Selisih jam server bisa salah karena zona waktu. Kalau `created_at` sedikit
  // di masa depan, sisa cooldown harus dibatasi jendela penuh, bukan negatif.
  const future = new Date(NOW + 10 * 60_000).toISOString();
  const remaining = cooldownRemainingMs(future, NOW);
  assert.equal(remaining, AFFILIATE_COOLDOWN_HOURS * HOUR, "harus dibatasi jendela penuh");
  assert.ok(remaining > 0, "sisa harus positif");
});

test("kode kosong tidak pernah diblokir", () => {
  const result = evaluateCooldown({
    affiliateCode: "",
    orderStatus: "success",
    lastCommissionedAt: ago(1 * HOUR),
    now: NOW,
  });
  assert.equal(result.blocked, false, "order tanpa kode tidak punya affiliate");
});

test("remainingHours membulatkan ke atas dan tidak pernah nol", () => {
  // Kalau 1 menit tersisa dibulatkan ke bawah, hasilnya 0 jam — user akan
  // mengira cooldown-nya habis lalu mencoba lagi dan ditolak.
  assert.equal(remainingHours(60_000), 1, "1 menit harus tetap 1 jam");
  assert.equal(remainingHours(0), 1, "0 ms tidak boleh jadi 0 jam");
  assert.equal(remainingHours(3 * HOUR), 3);
  assert.equal(remainingHours(23 * HOUR), 23);
});

test("konversi 0 klik ditampilkan null, bukan 0 persen", () => {
  // "0 klik, 0 pesanan → 0% konversi" itu menyesatkan: affiliate yang belum
  // pernah dipromosikan terlihat sama dengan affiliate yang 1000 klik tapi
  // tidak ada yang beli.
  assert.equal(conversionRate(0, 0), null);
  assert.equal(conversionRate(0, 5), null);
  assert.equal(conversionRate(10, 5), 0.5);
  assert.equal(conversionRate(10, 0), 0);
  assert.equal(conversionRate(1, 1), 1);
});
