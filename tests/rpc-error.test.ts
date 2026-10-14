import assert from "node:assert/strict";
import test from "node:test";

import { extractRpcMessage } from "../src/lib/supabase/rpc-error.ts";

/**
 * Pembersihan pesan error RPC.
 *
 * Pesan dari `supabaseRpc` berisi JSON PostgREST di dalam string-nya. Untuk
 * fitur role admin, isi `message` itu adalah satu-satunya penjelasan yang
 * berguna - operator harus tahu kenapa tombolnya ditolak, bukan melihat
 * nomor HTTP.
 *
 * Test di sini menjaga dua arah sekaligus: pesan yang benar-benar diambil,
 * DAN pesan yang tidak boleh hilang diam-diam kalau bentuknya berubah.
 */

const LOCKOUT_MESSAGE = "Ini superadmin aktif terakhir. Menonaktifkannya akan menutup akses dashboard untuk semua orang.";

test("pesan RPC PostgREST diambil apa adanya", () => {
  const body = JSON.stringify({
    message: LOCKOUT_MESSAGE,
    details: null,
    hint: null,
    code: "P0001",
  });
  const error = new Error(
    `Supabase RPC nambah_set_admin_role failed (400): ${body}`,
  );

  assert.equal(extractRpcMessage(error), LOCKOUT_MESSAGE);
});

test("nomor HTTP dan pembungkus tidak ikut terbawa", () => {
  const error = new Error(
    `Supabase RPC nambah_set_admin_role failed (400): ${JSON.stringify({
      message: "Role admin harus admin atau superadmin.",
    })}`,
  );

  const message = extractRpcMessage(error);

  assert.equal(message, "Role admin harus admin atau superadmin.");
  assert.doesNotMatch(message, /Supabase/);
  assert.doesNotMatch(message, /failed/);
  assert.doesNotMatch(message, /400/);
});

test("body dengan tanda kurung di dalam pesan tidak terpotong", () => {
  // `lastIndexOf("): ")` adalah jebakan: kalau pesannya sendiri memuat
  // pola itu, ambilannya bisa memotong pesan di tengah.
  const message = "Akun ditolak (perLUATURAN: role tidak cocok).";
  const error = new Error(
    `Supabase RPC x failed (400): ${JSON.stringify({ message })}`,
  );

  assert.equal(extractRpcMessage(error), message);
});

test("pesan multi-baris tetap utuh", () => {
  const message = "Baris pertama.\nBaris kedua.";
  const error = new Error(
    `Supabase RPC x failed (409): ${JSON.stringify({ message })}`,
  );

  assert.equal(extractRpcMessage(error), message);
});

test("error yang bukan RPC diteruskan apa adanya", () => {
  // Kegagalan lain (misal jaringan) tidak punya JSON. Pesan aslinya masih
  // berguna, dan mengembalikannya lebih baik daripada pesan generik.
  assert.equal(
    extractRpcMessage(new Error("fetch failed")),
    "fetch failed",
  );
});

test("body JSON rusak tidak membuat fungsi melempar", () => {
  const error = new Error('Supabase RPC x failed (500): {"message":');
  const message = extractRpcMessage(error);

  assert.equal(typeof message, "string");
  assert.ok(message.length > 0);
});

test("body JSON tanpa field message tidak menghasilkan undefined", () => {
  const error = new Error(
    `Supabase RPC x failed (400): ${JSON.stringify({ code: "42501" })}`,
  );

  const message = extractRpcMessage(error);

  assert.doesNotMatch(message, /undefined/);
  assert.ok(message.length > 0);
});

test("input aneh tidak melempar", () => {
  for (const input of [null, undefined, "", 0, {}, []]) {
    const message = extractRpcMessage(input);
    assert.equal(typeof message, "string", `harus string untuk ${JSON.stringify(input)}`);
  }
});

test("message kosong di body tidak menggantikan pesan yang ada", () => {
  const error = new Error(
    `Supabase RPC x failed (400): ${JSON.stringify({ message: "   " })}`,
  );

  assert.ok(extractRpcMessage(error).length > 0);
});