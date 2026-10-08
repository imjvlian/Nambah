import type { ReactNode } from "react";
import ConfirmProvider from "@/components/AdminConfirmDialog";

/**
 * Semua halaman admin memakai dialog konfirmasi yang sama, jadi aksi berisiko
 * (hapus, auto-map, sinkronisasi) konsisten visualnya dan tidak perlu
 * window.confirm bawaan browser.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <ConfirmProvider>{children}</ConfirmProvider>;
}