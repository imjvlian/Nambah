import type { ReactNode } from "react";

import AdminSidebarClient from "@/components/admin/AdminSidebarClient";
import { AdminSectionProvider } from "@/components/admin/AdminSectionContext";
import ConfirmProvider from "@/components/AdminConfirmDialog";
import "@/app/admin-control-center.css";

/**
 * Layout untuk SELURUH halaman di bawah `/admin`.
 *
 * Sidebar dan halaman sudah tidak punya shell masing-masing lagi.
 *
 * SEBELUMNYA
 *
 * Hanya `/admin` yang punya sidebar. Halaman seperti `/admin/affiliates`,
 * `/admin/banners`, `/admin/digiflazz`, `/admin/operations`, dan
 * `/admin/test-lab` berdiri sendiri dengan tombol "← Control Center",
 * jadi ada dua sistem navigasi yang tidak saling terhubung. Empat dari
 * halaman itu tidak bisa ditemukan kecuali operator sudah tahu URL-nya,
 * dan dari halaman manapun sidebar-nya hilang.
 *
 * SEKARANG
 *
 * Sidebar dirender di sini, sekali, untuk semua route. Halaman-halaman
 * itu cukup mengembalikan isi kontennya tanpa membuat shell apa pun -
 * otomatis dapat navigasi yang sama.
 *
 * `AdminSectionProvider` membungkus sidebar DAN konten sekaligus, karena
 * keduanya perlu tahu section dashboard yang sedang aktif. Keduanya
 * saudara di pohon React, jadi tanpa provider bersama satu tidak bisa
 * membaca state yang lain.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ConfirmProvider>
      <AdminSectionProvider>
        <div className="acc-shell">
          <AdminSidebarClient />
          <div className="acc-shell-content">{children}</div>
        </div>
      </AdminSectionProvider>
    </ConfirmProvider>
  );
}