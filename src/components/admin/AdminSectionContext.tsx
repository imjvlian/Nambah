"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AdminSectionId } from "@/components/admin/AdminSidebar";

/**
 * Seksi dashboard yang sedang aktif, dibagikan ke sidebar.
 *
 * KENAPA KONTEKS, BUKAN URL
 *
 * Sidebar sekarang dirender `layout.tsx`, sementara section yang aktif
 * adalah state milik `AdminDashboard`. Keduanya adalah saudara di pohon
 * React, bukan anak-anak - jadi satu tidak bisa membaca state yang lain
 * tanpa perantara. Pilihan lain adalah menjadikan URL sumber kebenaran,
 * tapi itu memaksa `useSearchParams` di kedua sisi dan membuat setiap
 * perpindahan section melewati router. Konteks lebih cepat dan tidak
 * bergantung pada perilaku router.
 *
 * SIDNEY SUMBER KEBENARANNYA
 *
 * Yang menulis ke konteks hanya `AdminDashboard`, lewat
 * `usePublishAdminSection`. Sidebar hanya membaca, lalu memakai
 * `setSection` saat butirnya diklik. Kalau sidebar menulis langsung,
 * dashboard tidak akan tahu - dan isi layarnya tidak akan ikut berubah.
 */
type AdminSectionState = {
  section: AdminSectionId | null;
  setSection: (section: AdminSectionId) => void;
};

const AdminSectionContext = createContext<AdminSectionState>({
  section: null,
  setSection: () => {},
});

export function AdminSectionProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<AdminSectionId | null>(null);

  // Stabil identitasnya supaya sidebar tidak ikut render ulang setiap
  // kali provider membuat fungsi baru.
  const set = useCallback((next: AdminSectionId) => setSection(next), []);

  const value = useMemo(() => ({ section, setSection: set }), [section, set]);

  return (
    <AdminSectionContext.Provider value={value}>
      {children}
    </AdminSectionContext.Provider>
  );
}

export function useAdminSection() {
  return useContext(AdminSectionContext);
}

/**
 * Laplacari section dashboard ke sidebar.
 *
 * Dipanggil dari `AdminDashboard` dengan state section-nya. Nilai null
 * selama dashboard belum selesai determining section - sidebar harus
 * membedakan "sedang memuat" dari "memang tidak ada yang aktif",
 * kalau tidak `/admin` akan terlihat sama dengan halaman terpisah.
 */
export function usePublishAdminSection(section: AdminSectionId | null) {
  const { setSection } = useAdminSection();

  // `useEffect`, bukan `useMemo`: menaruh efek samping di dalam `useMemo`
  // discouraged oleh React dan tidak dijamin dijalankan - kalau React
  // memutuskan memo itu tidak perlu dihitung ulang, section tidak akan
  // pernah sampai ke sidebar dan gejalanya persis "tidak ada tab aktif".
  useEffect(() => {
    if (section) setSection(section);
  }, [section, setSection]);
}