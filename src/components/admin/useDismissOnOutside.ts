"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Tutup panel dropdown saat klik di luar atau tekan Escape.
 *
 * DIPAKAI OLEH KEDUA PEMILIH TANGGAL
 *
 * Jadwal promo (`DateTimePicker`) dan rentang laporan
 * (`CalendarRangePicker`) butuh perilaku ini persis sama. Menyalinnya
 * berarti satu dari keduanya akan punya `Escape` yang lupa, atau listener
 * yang tidak dilepas - dan listener yang tidak dilepas akan menutup panel
 * milik instance lain.
 *
 * Kenapa `pointerdown`, bukan `click`:
 *
 * Dengan `click`, klik pertama yang menutup panel juga meneruskan klik ke
 * elemen di bawahnya. Untuk kalender tanggal itu berarti operator yang
 * bermaksud memilih tanggal bisa tanpa sengaja menekan tombol "Terapkan
 * rentang" atau memuat ulang laporan. Listener `pointerdown` menutup
 * panel sebelum klik itu sampai ke targetnya.
 */
export function useDismissOnOutside(
  open: boolean,
  onDismiss: () => void,
  containerRef: RefObject<HTMLElement | null>,
) {
  // Listener dipasang ulang hanya saat `onDismiss` berubah, bukan setiap
  // render. Kalau dipasang ulang tiap render, setiap ketikan di panel
  // akan membuat listener lama aktif dan baru aktif bersamaan.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        dismissRef.current();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissRef.current();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, containerRef]);
}