/**
 * Identitas admin dari hasil `authorizeAdminRequest`.
 *
 * Fungsi murni, tanpa I/O, supaya bisa diuji. Ini bukan pemolesan:
 * versi sebelumnya membaca identitas dari `auth.userId` lalu `auth.sub`,
 * padahal `authorizeAdminRequest` mengembalikan `{ ok: true, principal }`.
 * Keduanya selalu `undefined`, jadi approve permintaan affiliate membalas
 * 401 untuk semua admin dan tidak pernah bisa dipakai._gejala
 * "tidak berfungsi" tanpa pesan yang jelas.
 */

/**
 * Bentuk hasil `authorizeAdminRequest` saat berhasil.
 *
 * `AdminPrincipal` juga punya `mode`, `role`, dan `exp`, tapi yang
 * dibutuhkan di sini hanya `userId`.
 */
export type AuthorizedAdmin = {
  ok: true;
  principal: {
    mode?: string;
    userId?: string | null;
    role?: string;
    exp?: number;
  };
};

/**
 * User ID admin untuk kolom `reviewed_by`, atau `null`.
 *
 * `null` berarti "otorisasi sah, tapi tidak ada user yang bisa
 * dicatat". Itu kondisi nyata: sesi `legacy` (token API) memang tidak
 * punya user, dan kolom `reviewed_by` sudah `on delete set null` jadi
 * memang dirancang menerima null.
 *
 * Yang TIDAK boleh terjadi di sini adalah menolak request. Otorisasi
 * sudah ditangani `authorizeAdminRequest` sebelum fungsi ini dipanggil;
 * kegagalan atribusi bukan kegagalan izin. Versi lama mencampur keduanya
 * dan membalas 401 yang membuat fitur approve mati total.
 */
export function reviewedByUserId(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") return null;

  const principal = (auth as { principal?: unknown }).principal;
  if (!principal || typeof principal !== "object") return null;

  const userId = (principal as { userId?: unknown }).userId;
  return typeof userId === "string" && userId ? userId : null;
}