"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AdminSectionId } from "@/components/admin/AdminSidebar";

/**
 * Seksi dashboard yang sedang aktif, dibagikan ke sidebar DAN dashboard.
 *
 * KENAPA KONTEKS, BUKAN URL
 *
 * Sidebar sekarang dirender `layout.tsx`, sementara section yang aktif
 * adalah milik isi dashboard. Keduanya adalah saudara di pohon React,
 * bukan anak-anak - jadi satu tidak bisa membaca state yang lain tanpa
 * perantara. Pilihan lain adalah menjadikan URL sumber kebenaran, tapi
 * itu memaksa `useSearchParams` di kedua sisi dan membuat setiap
 * perpindahan section melewati router.
 *
 * SATU-SATUNYA SUMBER KEBENARAN
 *
 * Dulu section hidup di dua tempat sekaligus: `state section` milik
 * `AdminDashboard`, DAN salinannya di konteks ini. Dashboard menulis ke
 * konteks lewat `usePublishAdminSection`, lalu membaca balik dari
 * konteks lewat efek "adopt". Dua efek itu saling menimpa tanpa henti:
 * begitu nilainya beda sesaat, mereka bergantian menabrak section satu
 * sama lain dalam render berulang tanpa akhir, sampai React melaporkan
 * "Maximum update depth exceeded". Gejalanya halaman berkedip atau
 * looping setiap kali tab sidebar diklik dari halaman terpisah.
 *
 * Sekarang hanya ADA SATU state, yaitu yang di sini. Dashboard
 * membacanya, sidebar membacanya, dan `setSection` adalah satu-satunya
 * jalan untuk mengubahnya. `seedSection` dipakai sekali saat dashboard
 * mount, jadi tidak ada lagi dua pihak yang berlomba menulis.
 *
 * Kenapa `null` berarti "tidak ada dashboard di layar": saat operator
 * berada di `/admin/docs`, tidak ada section dashboard yang aktif, dan
 * sidebar harus bisa membedakan itu dari "dashboard-nya sedang
 * menampilkan Ringkasan".
 */
type AdminSectionState = {
  section: AdminSectionId | null;
  /**
   * Satu-satunya jalan mengubah section.
   *
   * `null` berarti "tidak ada dashboard di layar", dan itu dipakai juga
   * untuk membersihkan konteks saat dashboard turun.
   */
  setSection: (section: AdminSectionId | null) => void;
};

const AdminSectionContext = createContext<AdminSectionState>({
  section: null,
  setSection: () => {},
});

export function AdminSectionProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<AdminSectionId | null>(null);

  // Stabil identitasnya supaya sidebar tidak ikut render ulang setiap
  // kali provider membuat fungsi baru.
  const set = useCallback(
    (next: AdminSectionId | null) => setSection(next),
    [],
  );

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