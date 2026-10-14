import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_SESSION_COOKIE,
  getAdminRequestPrincipal,
  type AdminPrincipal,
} from "@/lib/admin-api";
import { canAccessScope, type AdminScope } from "@/lib/admin-scope";

/**
 * Penjaga untuk halaman admin yang berdiri sendiri di luar dashboard.
 *
 * Kenapa butuh penjaga tersendiri, padahal `authorizeAdminRequest` sudah
 * menolak endpoint-nya: halaman-halaman ini dirender server, dan isinya
 * bisa bocor sebelum endpoint mana pun sempat menolak. Dokumentasi admin,
 * misalnya, seluruhnya ada di bundle - memanggil endpoint tidak akan
 * pernah menahan isinya.
 *
 * KETIKA TIDAK ADA SESI
 *
 * Fungsi ini hanya mengalihkan kalau role-nya TERBUKA dan tidak berwenang.
 * Ketiadaan sesi tidak dialihkan ke sini: halaman-halaman ini dulu tidak
 * punya penjaga autentikasi apa pun dan mengandalkan 401 dari endpoint.
 * Menambahkan pengalihan untuk kasus itu akan mengubah perilaku yang belum
 * diminta - dan membuat "belum masuk" berbeda dari "tidak boleh".
 *
 * Prinsipnya: fungsi ini menambah satu aturan (role), bukan menambah dua.
 */
export async function requireAdminPageScope(
  scope: AdminScope,
  fallback = "/admin",
): Promise<AdminPrincipal | null> {
  const store = await cookies();
  const value = store.get(ADMIN_SESSION_COOKIE)?.value ?? "";

  if (!value) return null;

  /*
   * `getAdminRequestPrincipal` bekerja pada nilai cookie bertanda tangan,
   * bukan pada objek Request yang sebenarnya. Cookie di sini dibaca lewat
   * `cookies()` karena pemanggilnya server component, yang tidak punya
   * objek Request.
   */
  const principal = getAdminRequestPrincipal(
    new Request("http://localhost/", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${value}` },
    }),
  );

  if (!principal) return null;
  if (canAccessScope(principal.role, scope)) return principal;

  redirect(fallback);
}