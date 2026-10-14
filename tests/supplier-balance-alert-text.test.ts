import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBalanceAlertMessage,
  decideBalanceNotify,
  getStatus,
} from "../src/lib/supplier-balance-alert-text.ts";

/**
 * Alert saldo supplier.
 *
 * Yang diuji: nama supplier harus datang dari data, bukan teks yang
 * ditulis di dalam string. Kalau tidak, alert Melostore akan_read
 * "Saldo Digiflazz KRITIS" dan admin mengisi saldo ke supplier yang
 * salah - kesalahan yang hanya ketahauan setelah uang salah transfer.
 */

test("getStatus: ambang kritis diperiksa lebih dulu dari ambang rendah", () => {
  // Saldo di bawah KEDUA ambang harus kritis, bukan low.
  assert.equal(getStatus(50_000, 300_000, 100_000), "critical");
  assert.equal(getStatus(200_000, 300_000, 100_000), "low");
  assert.equal(getStatus(900_000, 300_000, 100_000), "healthy");
});

test("getStatus: tepat di ambang tetap terpicu", () => {
  assert.equal(getStatus(100_000, 300_000, 100_000), "critical");
  assert.equal(getStatus(300_000, 300_000, 100_000), "low");
});

const base = {
  status: "critical" as const,
  previousStatus: "healthy" as const,
  balance: 120_000,
  reservedBalance: 20_000,
  availableBalance: 100_000,
  targetBalance: 1_000_000,
  recommendedDeposit: 900_000,
};

test("pesan saldo menyebut nama supplier yang diberikan", () => {
  const melostore = buildBalanceAlertMessage({
    ...base,
    supplierLabel: "Melostore",
  });
  assert.match(melostore, /Saldo Melostore KRITIS/);
  assert.match(melostore, /Supplier: Melostore/);
  assert.doesNotMatch(melostore, /Digiflazz/);

  const digiflazz = buildBalanceAlertMessage({
    ...base,
    supplierLabel: "Digiflazz",
  });
  assert.match(digiflazz, /Saldo Digiflazz KRITIS/);
  assert.doesNotMatch(digiflazz, /Melostore/);
});

test("pesan saldo memuat angka saldo, reserved, tersedia, dan saran deposit", () => {
  const text = buildBalanceAlertMessage({ ...base, supplierLabel: "Melostore" });

  assert.match(text, /Status: CRITICAL/);
  assert.match(text, /Sebelumnya: HEALTHY/);
  assert.match(text, /Saldo: Rp\s?120\.000/);
  assert.match(text, /Reserved: Rp\s?20\.000/);
  assert.match(text, /Tersedia: Rp\s?100\.000/);
  assert.match(text, /Target: Rp\s?1\.000\.000/);
  assert.match(text, /Saran deposit: Rp\s?900\.000/);
});

test("tanpa status sebelumnya, baris 'Sebelumnya' tidak ikut dicetak", () => {
  const text = buildBalanceAlertMessage({
    ...base,
    previousStatus: null,
    supplierLabel: "Melostore",
  });

  assert.doesNotMatch(text, /Sebelumnya/);
  assert.doesNotMatch(text, /undefined/);
});

test("status healthy memakai ikon dan judul 'kembali aman'", () => {
  const text = buildBalanceAlertMessage({
    ...base,
    status: "healthy",
    supplierLabel: "Digiflazz",
  });

  assert.match(text, /Saldo Digiflazz kembali aman/);
});

/*
 * Aturan "kirim atau tidak".
 *
 * Sandbox adalah bagian yang paling mudah salah: Melostore dalam mode
 * sandbox selalu bersaldo 0, jadi tanpa penahan ini cron mengirim
 * "Saldo Melostore KRITIS" di setiap berjalan. Alert yang selalu benar
 * membuat operator berhenti membaca alert.
 */
test("sandbox tidak pernah mengirim alert, meski status berubah ke kritis", () => {
  const decision = decideBalanceNotify({
    notify: true,
    sandbox: true,
    statusChanged: true,
    previousStatus: null,
    status: "critical",
  });

  assert.deepEqual(decision, { send: false, reason: "sandbox" });
});

test("snapshot pertama yang kritis tetap mengirim alert di mode live", () => {
  const decision = decideBalanceNotify({
    notify: true,
    sandbox: false,
    statusChanged: true,
    previousStatus: null,
    status: "critical",
  });

  assert.deepEqual(decision, { send: true });
});

test("snapshot pertama yang healthy tidak mengirim alert", () => {
  const decision = decideBalanceNotify({
    notify: true,
    sandbox: false,
    statusChanged: true,
    previousStatus: null,
    status: "healthy",
  });

  assert.deepEqual(decision, { send: false, reason: "no-change-reference" });
});

test("status tidak berubah tidak mengirim alert", () => {
  const decision = decideBalanceNotify({
    notify: true,
    sandbox: false,
    statusChanged: false,
    previousStatus: "critical",
    status: "critical",
  });

  assert.deepEqual(decision, { send: false, reason: "unchanged" });
});

test("tanpa permintaan notify, tidak ada yang dikirim walau kritis", () => {
  const decision = decideBalanceNotify({
    notify: false,
    sandbox: false,
    statusChanged: true,
    previousStatus: "healthy",
    status: "critical",
  });

  assert.deepEqual(decision, { send: false, reason: "not-requested" });
});

test("sandbox diperiksa sebelum 'tidak berubah', jadi alasannya jujur", () => {
  // Kalau tidak, snapshot sandbox yang statusnya sama akan dilaporkan
  // "unchanged" - yang menyiratkan sistem membandingkan dengan riwayat
  // nyata, padahal tidak ada perbandingan yang bermakna.
  const decision = decideBalanceNotify({
    notify: true,
    sandbox: true,
    statusChanged: false,
    previousStatus: "critical",
    status: "critical",
  });

  assert.deepEqual(decision, { send: false, reason: "sandbox" });
});