import assert from "node:assert/strict";
import test from "node:test";

import { reviewedByUserId } from "../src/lib/admin-identity.ts";

/**
 * Identitas admin untuk `reviewed_by`.
 *
 * Test ini ada karena bug sebelumnya tidak bisa diuji di tempat lain:
 * `adminIdentity` versi lama salah membaca `auth.userId`, jadi selalu
 * mengembalikan `null`, dan approve permintaan affiliate membalas 401
 * untuk semua admin. Tidak ada satu pun test yang menangkapnya karena
 * logikanya tersembunyi di dalam route yang butuh sesi admin sungguhan.
 *
 * Yang dijaga di sini bukan cuma "userId terbaca", tapi juga bahwa nilai
 * yang dikembalikan adalah `null` - bukan error - saat user memang tidak
 * yang sudah diedit ulang jadi dua arah yang sama: hidupkan kembali
 * sama.
 */

const UUID = "11111111-2222-3333-4444-555555555555";

test("bentuk resmi authorizeAdminRequest terbaca utuh", () => {
  const auth = {
    ok: true as const,
    principal: {
      mode: "account",
      userId: UUID,
      role: "superadmin" as const,
      exp: 1_700_000_000,
    },
  };

  assert.equal(reviewedByUserId(auth), UUID);
});

test("BUG LAMA: userId ada di principal, tidak di root", () => {
  // Bentuk yang benar-benar dikirim `authorizeAdminRequest`. Versi lama
  // mencari `auth.userId` dan `auth.sub`, keduanya `undefined`, sehingga
  // selalu jatuh ke 401.
  const auth = { ok: true, principal: { mode: "account", userId: UUID } };

  assert.notEqual((auth as Record<string, unknown>).userId, UUID);
  assert.equal(reviewedByUserId(auth), UUID);
});

test("sesi legacy tanpa user menghasilkan null, bukan error", () => {
  // Token API memang tidak punya user. `reviewed_by` nullable dengan
  // `on delete set null`, jadi null adalah jawaban yang benar.
  const auth = {
    ok: true,
    principal: { mode: "legacy", userId: null, role: "legacy" },
  };

  assert.equal(reviewedByUserId(auth), null);
});

test("userId string kosong diperlakukan sama dengan tidak ada", () => {
  assert.equal(reviewedByUserId({ ok: true, principal: { userId: "" } }), null);
});

test("userId bukan string ditolak diam-diam, bukan diteruskan", () => {
  for (const value of [0, 1, true, {}, [], () => {}]) {
    assert.equal(
      reviewedByUserId({ ok: true, principal: { userId: value } }),
      null,
    );
  }
});

test("bentuk rusak tidak melempar exception", () => {
  // Route tidak boleh 500 karena `auth` datang dari lapisan auth yang
  // bisa berubah bentuknya. Fungsi ini selalu mengembalikan null atau
  // UUID.
  const inputs: unknown[] = [
    null,
    undefined,
    "",
    "token",
    42,
    [],
    {},
    { ok: false, response: {} },
    { ok: true },
    { ok: true, principal: null },
    { ok: true, principal: "principal" },
    { ok: true, principal: {} },
  ];

  for (const input of inputs) {
    assert.equal(reviewedByUserId(input), null);
  }
});