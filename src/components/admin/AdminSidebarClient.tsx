"use client";

import { usePathname } from "next/navigation";

import AdminSidebar from "@/components/admin/AdminSidebar";

/**
 * Pembungkus client untuk sidebar admin.
 *
 * Sidebar butuh `usePathname` untuk menandai butir aktif, dan `usePathname`
 * hanya boleh dipakai di komponen client - sedangkan `layout.tsx` adalah
 * server component. Komponen ini adalah tempat penyambungnya.
 *
 * TIDAK LAGI memakai `useSearchParams`.
 *
 * Sebelumnya section aktif dibaca dari query `?seksi=`. Itu rapuh karena
 * dashboard MENGHAPUS query itu setelah membacanya, jadi dari sisi sidebar
 * tidak ada satu pun halaman `/admin` yang bisa menampilkan tab aktif -
 * gejalanya "tidak ada tab yang aktif" setiap kali dashboard dibuka.
 *
 * Sekarang section aktif datang dari `AdminSectionContext`, yang ditulis
 * dashboard saat section-nya benar-benar berubah. Tidak ada lagi proses
 * baca-hapus yang bisa saling meniadakan.
 */
export default function AdminSidebarClient() {
  const pathname = usePathname();

  return <AdminSidebar activeHref={pathname} />;
}