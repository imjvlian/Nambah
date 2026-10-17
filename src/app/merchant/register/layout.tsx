/**
 * Layout untuk `/merchant/register`.
 *
 * HANYA BERISI route segment config - tidak ada markup, tidak ada efek.
 *
 * Kenapa layout dan bukan `page.tsx`: file `page.tsx` di folder ini diawali
 * `"use client"`, dan Next.js tidak mendukung route segment config dari
 * Client Component. Satu-satunya tempat yang bisa menetapkannya tanpa
 * memindahkan seluruh isi form ke komponen client terpisah adalah layout.
 *
 * Kenapa halaman ini WAJIB dynamic:
 *
 * `middleware` memasang CSP dengan nonce BARU setiap request
 * (`'nonce-<uuid>'` + `'strict-dynamic'`, lihat `src/lib/csp.ts`). HTML yang
 * di-prerender saat build tidak punya nonce - saat build tidak ada request,
 * jadi tidak ada nilai untuk disisipkan ke tag <script>. Browser lalu menolak
 * setiap script dan form pendaftaran tidak pernah bisa mengirim apa pun.
 *
 * Tidak ada sisi-baiknya: halaman ini low-traffic, stateless, dan tidak pernah
 * ought to be prerendered. Penjelasan lengkap di `src/app/admin/page.tsx`,
 * aturan dijaga `tests/csp-static-page.test.ts`.
 */
export const dynamic = "force-dynamic";

export default function MerchantRegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}