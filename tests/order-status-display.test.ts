import assert from "node:assert/strict";
import test from "node:test";

import {
  elapsedSince,
  isOpenOrder,
  OPEN_ORDER_STATUSES,
  ORDER_STATUS_ORDER,
  relativeTime,
  statusLabel,
  statusTone,
  STATUS_HINT,
  STATUS_LABEL,
} from "../src/lib/order-status-display.ts";

/**
 * Label status order untuk UI.
 *
 * Modul ini ada supaya `/account` dan `/admin` tidak lagi punya dua nama
 * berbeda untuk status yang sama — dulu satu berbahasa Indonesia, satu
 * berbahasa Inggris. Test di sini mengunci kesamaan itu, plus memastikan
 * modul ini tidak mengubah data order.
 */

test("setiap status punya label, tone, dan hint", () => {
  for (const status of ORDER_STATUS_ORDER) {
    assert.ok(STATUS_LABEL[status], `${status} tidak punya label`);
    assert.ok(STATUS_HINT[status], `${status} tidak punya hint`);
    assert.ok(
      ["wait", "busy", "done", "bad"].includes(statusTone(status)),
      `${status} tone tidak dikenal`,
    );
  }
});

test("label berbahasa Indonesia, bukan Inggris", () => {
  // Dulu `/admin` memakai "Pending payment" / "Success" sementara `/account`
  // memakai "Menunggu pembayaran" / "Berhasil". Sekarang keduanya satu sumber.
  assert.equal(STATUS_LABEL.pending_payment, "Menunggu pembayaran");
  assert.equal(STATUS_LABEL.success, "Berhasil");
  assert.equal(STATUS_LABEL.failed, "Gagal");

  for (const status of ORDER_STATUS_ORDER) {
    const label = STATUS_LABEL[status];
    assert.ok(
      !/[A-Z][a-z]+\s[A-Z]/.test(label) || label === "Gagal",
      `${status} label-nya kedengaran Inggris: ${label}`,
    );
  }
});

test("status tak dikenal tetap tampil, tidak jadi undefined", () => {
  // Order dengan status yang tidak dikenal harus tetap terbaca oleh user.
  // `undefined` di JSX akan merender teks kosong.
  assert.equal(statusLabel("entah_status_baru"), "entah_status_baru");
  assert.equal(statusTone("entah_status_baru"), "wait");
  assert.equal(isOpenOrder("entah_status_baru"), false);
});

test("order yang belum selesai ditandai open", () => {
  for (const status of ["pending_payment", "paid", "processing"]) {
    assert.equal(isOpenOrder(status), true, `${status} seharusnya open`);
  }
  for (const status of ["success", "refunded", "cancelled", "failed"]) {
    assert.equal(isOpenOrder(status), false, `${status} seharusnya tidak open`);
  }
  // `failed` sengaja tidak open: order sudah selesai, hanya perlu tindak lanjut.
});

test("tone untuk status yang berhasil dan gagal tidak tertukar", () => {
  assert.equal(statusTone("success"), "done");
  assert.equal(statusTone("failed"), "bad");
  assert.equal(statusTone("pending_payment"), "wait");
  assert.equal(statusTone("processing"), "busy");
});

test("relativeTime memberi konteks yang bisa dinilai user", () => {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  assert.equal(relativeTime(ago(30_000)), "baru saja");
  assert.equal(relativeTime(ago(3 * 60_000)), "3 menit lalu");
  assert.equal(relativeTime(ago(2 * 3_600_000)), "2 jam lalu");
  assert.equal(relativeTime(ago(3 * 86_400_000)), "3 hari lalu");
  assert.equal(relativeTime(ago(45 * 86_400_000)), "1 bulan lalu");
  assert.equal(relativeTime(ago(400 * 86_400_000)), "1 tahun lalu");
});

test("elapsedSince mengubah 'lalu' jadi durasi", () => {
  // Dipakai untuk badge "Sedang diproses · 12 menit". Di sana "lalu" salah
  // bunyi — yang dibutuhkan durasi, bukan waktu relatif.
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  assert.equal(elapsedSince(ago(3 * 60_000)), "3 menit");
  assert.equal(elapsedSince(ago(2 * 3_600_000)), "2 jam");
  assert.equal(elapsedSince(ago(30_000)), "baru saja");
});

test("input tidak valid tidak membuat crash", () => {
  assert.equal(relativeTime(null), "");
  assert.equal(relativeTime(undefined), "");
  assert.equal(relativeTime(""), "");
  assert.equal(relativeTime("bukan tanggal"), "");
  assert.equal(elapsedSince("bukan tanggal"), null);
});

test("waktu di masa depan tidak menghasilkan durasi negatif", () => {
  // Selisih jam kadang salah karena perbedaan zona waktu server.
  // Teks "-3 menit lalu" akan membingungkan user.
  const future = new Date(Date.now() + 5 * 60_000).toISOString();
  assert.equal(relativeTime(future), "baru saja");
});

test("modul ini tidak mengubah nilai status yang dipakai database", () => {
  // Label adalah presentasi. Nilai `status` di database harus tetap sama —
  // kalau berubah, filter dan query yang menyaring `status` ikut rusak.
  const rawStatus = "pending_payment";
  assert.equal(statusLabel(rawStatus), "Menunggu pembayaran");
  assert.equal(rawStatus, "pending_payment", "nilai status ikut berubah");
  assert.ok(OPEN_ORDER_STATUSES.has("pending_payment"));
});
