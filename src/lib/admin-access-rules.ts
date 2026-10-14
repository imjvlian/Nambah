/**
 * Aturan perubahan role akun admin.
 *
 * FUNGSI INI MURNI: tidak menyentuh database, tidak membaca request, tidak
 * menulis apa pun. Semuanya masuk lewat parameter dan keluar lewat nilai
 * balik. Itu disengaja.
 *
 * Kenapa harus bisa diuji tanpa sesi admin sungguhan: bug sebelumnya di area
 * ini (`admin-identity.ts`) tidak ditemukan test mana pun karena logikanya
 * tersembunyi di dalam route yang butuh cookie admin yang valid. Memindahkan
 * keputusannya ke sini memindahkannya ke tempat yang bisa diuji.
 *
 * ATURANNYA SATU KALI DI SINI
 *
 * Route, migration, dan UI semuanya memakai fungsi yang sama. Kalau route
 * punya syarat sendiri, hasilnya dua tempat berbeda bisa berbeda jawaban
 * untuk pertanyaan yang sama - dan yang salah akan dipercaya.
 */

/** Role yang diizinkan di `admin_users`. */
export type AdminRole = "admin" | "superadmin";

/**
 * Bentuk peran yang sedang bekerja.
 *
 * `legacy` bukan nilai di `admin_users`: itu mode token API, tanpa akun.
 * Token itu berkuasa penuh di server - `authorizeAdminRequest` sudah
 * mengizinkannya untuk `superadminOnly` - jadi ia boleh mengambil keputusan
 * di sini juga. Kalau tidak, jalur pemulihan resmi akan ikut terkunci.
 */
export type AdminActorRole = AdminRole | "legacy";

export type RoleChangeDecision =
  | { ok: true; action: "promote" | "demote" }
  | { ok: false; status: number; error: string };

export type RoleChangeInput = {
  actorRole: string;
  actorUserId: string | null;
  targetUserId: string;
  targetRole: AdminRole;
  targetActive: boolean;
  /** Role target SESUDAH perubahan. */
  nextRole: AdminRole;
  nextActive: boolean;
  /** Jumlah superadmin aktif saat ini. */
  activeSuperadminCount: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "admin" || value === "superadmin";
}

export function canManageAdmins(actorRole: string): boolean {
  return actorRole === "superadmin" || actorRole === "legacy";
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

/**
 * Apakah jumlah superadmin aktif akan habis kalau perubahan ini diterapkan.
 *
 * Dipakai UI untuk menonaktifkan tombol sebelum request dikirim, dan dipakai
 * route untuk menolak. Keduanya memanggil fungsi yang sama supaya tidak
 * mungkin berbeda jawaban.
 */
export function wouldRemoveLastSuperadmin(input: {
  /** Role target SEKARANG. */
  targetRole: AdminRole;
  /** Apakah target sekarang aktif. */
  targetActive: boolean;
  /** Aktif atau tidak setelah perubahan. */
  nextActive: boolean;
  /** Role target SESUDAH perubahan. */
  nextRole: AdminRole;
  activeSuperadminCount: number;
}) {
  /*
   * Syarat dua baris pertama: kalau targetnya bukan superadmin aktif,
   * perubahan apa pun tidak bisa mengurangi jumlah superadmin. Tanpa itu,
   * demote admin biasa akan ikut ditolak di sistem yang hanya punya satu
   * superadmin - padahal yang hilang bukan superadmin itu.
   */
  if (input.targetRole !== "superadmin") return false;
  if (!input.targetActive) return false;

  /*
   * Superadmin bisa hilang lewat DUA jalan, dan hanya satu yang biasanya
   * Visible: dinonaktifkan, atau diturunkan rolenya jadi admin biasa.
   *
   * Jalur kedua jarang dipakai UI saat ini - demote selalu berarti status
 * nonaktif - tapi tetap harus diperiksa. Kalau tidak, menurunkan superadmin
 * terakhir ke admin biasa akan lolos, dan sistem akan diam-diam punya
 * nol superadmin sementara semua tombolnya terlihat normal.
   */
  const removesSuperadmin = !input.nextActive || input.nextRole !== "superadmin";
  if (!removesSuperadmin) return false;

  return input.activeSuperadminCount <= 1;
}

/**
 * Keputusan atas satu permintaan perubahan role.
 *
 * Urutan pemeriksaan disengaja: yang paling informatif didahulukan. Pesan
 * "Anda tidak bisa mencabut akses sendiri" jauh lebih berguna daripada
 * "validasi gagal", jadi self-demote diperiksa sebelum hal generik apa pun.
 */
export function decideRoleChange(input: RoleChangeInput): RoleChangeDecision {
  if (!canManageAdmins(input.actorRole)) {
    return {
      ok: false,
      status: 403,
      error: "Hanya superadmin yang bisa mengubah akses admin.",
    };
  }

  if (!isUuid(input.targetUserId)) {
    return {
      ok: false,
      status: 400,
      error: "Akun tujuan tidak valid.",
    };
  }

  if (!isAdminRole(input.targetRole)) {
    return {
      ok: false,
      status: 400,
      error: "Role admin harus admin atau superadmin.",
    };
  }

  /*
   * Menonaktifkan akun sendiri DITOLAK, termasuk oleh superadmin yang sedang
   * bekerja.
   *
   * Alasannya bukan teknikal: operator yang sedang mencabut akses akunnya
   * sendiri akan kehilangan dashboard sebelum sempat membaca apa pun lagi.
   * Kalau ia satu-satunya superadmin, pemulihannya adalah SQL di server.
   *
   * `legacy` lolos karena mode token tidak punya akun - tidak ada "diri
   * sendiri" yang perlu dilindungi, dan mengunci jalur pemulihan adalah
   * hasil yang lebih buruk daripada risikonya.
   */
  if (
    !input.nextActive &&
    input.actorUserId &&
    input.targetUserId.trim() === input.actorUserId.trim()
  ) {
    return {
      ok: false,
      status: 409,
      error: "Anda tidak bisa mencabut akses admin milik akun Anda sendiri.",
    };
  }

  if (
    wouldRemoveLastSuperadmin({
      targetRole: input.targetRole,
      targetActive: input.targetActive,
      nextActive: input.nextActive,
      nextRole: input.nextRole,
      activeSuperadminCount: input.activeSuperadminCount,
    })
  ) {
    return {
      ok: false,
      status: 409,
      error:
        "Ini superadmin aktif terakhir. Menonaktifkannya akan menutup akses dashboard untuk semua orang.",
    };
  }

  return { ok: true, action: input.nextActive ? "promote" : "demote" };
}