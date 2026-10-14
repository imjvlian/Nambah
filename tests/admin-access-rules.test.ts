import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageAdmins,
  decideRoleChange,
  isUuid,
  wouldRemoveLastSuperadmin,
  type RoleChangeInput,
} from "../src/lib/admin-access-rules.ts";

/**
 * Aturan promote/demote akun admin.
 *
 * Yang dijaga di sini adalah satu hal yang tidak bisa dipulihkan kalau rusak:
 * tidak boleh pernah ada keadaan nol superadmin aktif. Keadaan itu menutup
 * dashboard untuk semua orang, dan pemulihannya bukan klik - itu SQL manual
 * di server.
 *
 * Test ini murni, tanpa database dan tanpa cookie. Itu pilihan sadar: area
 * admin pernah punya bug yang tidak bisa ditemukan test mana pun karena
 * logikanya tersembunyi di route yang butuh sesi sungguhan.
 */

const SUPER_UUID = "11111111-2222-3333-4444-555555555555";
const OTHER_UUID = "99999999-8888-7777-6666-555555555555";

function input(overrides: Partial<RoleChangeInput> = {}): RoleChangeInput {
  return {
    actorRole: "superadmin",
    actorUserId: SUPER_UUID,
    targetUserId: OTHER_UUID,
    targetRole: "admin",
    targetActive: false,
    nextActive: true,
    activeSuperadminCount: 2,
    ...overrides,
  };
}

test("promote customer jadi admin boleh", () => {
  const decision = decideRoleChange(input());
  assert.deepEqual(decision, { ok: true, action: "promote" });
});

test("promote jadi superadmin juga boleh", () => {
  const decision = decideRoleChange(input({ targetRole: "superadmin" }));
  assert.equal(decision.ok, true);
});

test("actor admin biasa ditolak", () => {
  const decision = decideRoleChange(input({ actorRole: "admin" }));
  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.equal(decision.status, 403);
  assert.match(decision.error, /superadmin/i);
});

test("actor legacy boleh - token API berkuasa penuh di server", () => {
  const decision = decideRoleChange(input({ actorRole: "legacy" }));
  assert.equal(decision.ok, true);
});

test("role tidak dikenal ditolak", () => {
  for (const actorRole of ["", "owner", "super", "ADMIN", "true"]) {
    assert.equal(decideRoleChange(input({ actorRole })).ok, false);
  }
});

test("userId bukan UUID ditolak", () => {
  for (const targetUserId of ["", "abc", "1", "1111", null as unknown as string]) {
    const decision = decideRoleChange(input({ targetUserId }));
    assert.equal(decision.ok, false, `harus ditolak: ${JSON.stringify(targetUserId)}`);
    if (decision.ok) continue;
    assert.equal(decision.status, 400);
  }
});

test("role tujuan di luar admin/superadmin ditolak", () => {
  for (const targetRole of ["mitra", "", "ADMIN", "superadmin "] as const) {
    const decision = decideRoleChange(input({ targetRole: targetRole as never }));
    assert.equal(decision.ok, false, `harus ditolak: ${targetRole}`);
  }
});

test("demote diri sendiri ditolak, walau superadmin terakhir", () => {
  /*
   * Dua pengaman bertumpuk di sini: self-demote DAN superadmin terakhir.
   * Yang diuji adalah yang pertama - kalau pengaman kedua yang bekerja,
   * pesannya akan salah dan operator akan mengira masalahnya jumlah admin.
   */
  const decision = decideRoleChange(
    input({
      targetUserId: SUPER_UUID,
      targetRole: "superadmin",
      targetActive: true,
      nextActive: false,
      activeSuperadminCount: 1,
    }),
  );

  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.match(decision.error, /akun Anda sendiri/);
});

test("demote superadmin terakhir ditolak", () => {
  const decision = decideRoleChange(
    input({
      targetUserId: OTHER_UUID,
      targetRole: "superadmin",
      targetActive: true,
      nextActive: false,
      activeSuperadminCount: 1,
    }),
  );

  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.equal(decision.status, 409);
  assert.match(decision.error, /superadmin aktif terakhir/);
});

test("demote superadmin terakhir oleh legacy tetap ditolak", () => {
  /*
   * Jalur pemulihan harus tetap bisa mencabut akses ORANG LAIN, tapi tidak
   * boleh bisa mengunci sistem - termasuk lewat mode token.
   */
  const decision = decideRoleChange(
    input({
      actorRole: "legacy",
      actorUserId: null,
      targetRole: "superadmin",
      targetActive: true,
      nextActive: false,
      activeSuperadminCount: 1,
    }),
  );

  assert.equal(decision.ok, false);
});

test("demote admin biasa BOLEH walau cuma ada satu superadmin", () => {
  /*
   * Bug yang paling mudah terjadi: pengaman lockout terlalu agresif, lalu
   * demote admin biasa ikut ditolak. Operator akan mengira tidak bisa
   * mencabut akses siapa pun.
   */
  const decision = decideRoleChange(
    input({
      targetRole: "admin",
      targetActive: true,
      nextActive: false,
      activeSuperadminCount: 1,
    }),
  );

  assert.deepEqual(decision, { ok: true, action: "demote" });
});

test("demote superadmin kedua boleh - masih ada yang tersisa", () => {
  const decision = decideRoleChange(
    input({
      targetRole: "superadmin",
      targetActive: true,
      nextActive: false,
      activeSuperadminCount: 2,
    }),
  );

  assert.deepEqual(decision, { ok: true, action: "demote" });
});

test("promote superadmin tidak pernah dianggap menghapus superadmin", () => {
  /*
   * Hanya demote yang mengurangi jumlah. Promote harus tetap lolos walau
   * sedang menghitung ulang jumlah superadmin yang menyisakan satu.
   */
  const decision = decideRoleChange(
    input({
      targetRole: "superadmin",
      targetActive: false,
      nextActive: true,
      activeSuperadminCount: 1,
    }),
  );

  assert.deepEqual(decision, { ok: true, action: "promote" });
});

test("aksi dibedakan: promote kalau diaktifkan, demote kalau tidak", () => {
  assert.equal(decideRoleChange(input({ nextActive: true })).ok, true);
  const demote = decideRoleChange(input({ nextActive: false }));
  assert.deepEqual(demote, { ok: true, action: "demote" });
});

test("wouldRemoveLastSuperadmin hanya menyala pada keadaan yang benar", () => {
  const base = {
    targetRole: "superadmin" as const,
    targetActive: true,
    nextActive: false,
    nextRole: "superadmin" as const,
    activeSuperadminCount: 1,
  };

  // Keadaan yang harus menyala.
  assert.equal(wouldRemoveLastSuperadmin(base), true);

  // Dua superadmin: masih ada yang tersisa.
  assert.equal(wouldRemoveLastSuperadmin({ ...base, activeSuperadminCount: 2 }), false);

  // Targetnya superadmin tapi sudah nonaktif - tidak ada yang berkurang.
  assert.equal(wouldRemoveLastSuperadmin({ ...base, targetActive: false }), false);

  // Targetnya admin biasa, bukan superadmin sama sekali.
  assert.equal(
    wouldRemoveLastSuperadmin({ ...base, targetRole: "admin" }),
    false,
  );

  // Promote: jumlah bertambah, bukan berkurang.
  assert.equal(wouldRemoveLastSuperadmin({ ...base, nextActive: true }), false);
});

test("menurunkan superadmin terakhir ke admin biasa juga dihitung kehilangan", () => {
  /*
   * Jalur kedua yang hilang dari UI tapi nyata di database: superadmin aktif
   * yang rolenya diturunkan jadi admin biasa, tanpa dinonaktifkan. Jumlah
   * superadmin tetap berkurang satu, jadi harus ikut terblokir.
   */
  const turunkanRole = {
    targetRole: "superadmin" as const,
    targetActive: true,
    nextActive: true,
    nextRole: "admin" as const,
    activeSuperadminCount: 1,
  };

  assert.equal(wouldRemoveLastSuperadmin(turunkanRole), true);
  assert.equal(
    wouldRemoveLastSuperadmin({ ...turunkanRole, activeSuperadminCount: 2 }),
    false,
  );
});

test("promote superadmin yang sama sekali tidak dihitung kehilangan", () => {
  // Role tetap superadmin dan tetap aktif: jumlah tidak berubah sama sekali.
  assert.equal(
    wouldRemoveLastSuperadmin({
      targetRole: "superadmin",
      targetActive: false,
      nextActive: true,
      nextRole: "superadmin",
      activeSuperadminCount: 1,
    }),
    false,
  );
});

test("canManageAdmins hanya menerima superadmin dan legacy", () => {
  assert.equal(canManageAdmins("superadmin"), true);
  assert.equal(canManageAdmins("legacy"), true);
  assert.equal(canManageAdmins("admin"), false);
  assert.equal(canManageAdmins(""), false);
  assert.equal(canManageAdmins("Superadmin"), false);
});

test("isUuid menolak UUID dengan spasi di tengah", () => {
  assert.equal(isUuid(SUPER_UUID), true);
  assert.equal(isUuid(` ${SUPER_UUID} `), true);
  assert.equal(isUuid(`${SUPER_UUID} `), true);
  assert.equal(isUuid("1111 2222 3333"), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(123), false);
});