"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  BULAN,
  HARI,
  formatKey,
  formatRangeShort,
  fromKey,
  monthMatrix,
  toKey,
  todayKey,
} from "@/lib/admin-calendar";
import { useDismissOnOutside } from "./useDismissOnOutside";

/**
 * Pemilih rentang tanggal, dalam bentuk dropdown.
 *
 * KENAPA DROPDOWN, BUKAN PANEL INLINE
 *
 * Versi sebelumnya langsung membuka dua bulan kalender di antara tombol
 * preset dan grafik. Akibatnya memilih rentang mendorong seluruh isi
 * laporan ke bawah - dan laporan itu bisa panjang. Operator yang sedang
 * membaca grafik harus menggulir balik ke atas hanya untuk melihat
 * kalender, lalu menggulir lagi setelah memilih.
 *
 * Sekarang rentang hidup di balik tombol, sama seperti jadwal promo.
 * Yang berubah bukan hanya bentuknya: kalender dua bulan yang tadinya
 * hampir selalu terlihat kini hanya muncul saat diminta, sehingga grafik
 * dan tabelnya tidak melompat.
 *
 * KELAS YANG SAMA DENGAN JADWAL PROMO
 *
 * Panel, tombol pemicu, dan grid bulan memakai `.acc-dtpicker-*` dan
 * `.acc-cal-*` - kelas yang sama persis dengan `DateTimePicker`. Jadi
 * kalender di form promo dan kalender di laporan bukan "mirip": mereka
 * memakai aturan yang sama, jadi tidak bisa berbeda tanpa disengaja.
 *
 * Yang membedakan hanya isinya: rentang menampilkan DUA bulan supaya
 * awal dan akhir bisa dibaca tanpa menggulir, dan tidak punya pengatur
 * jam karena laporan selalu dihitung per hari penuh.
 */

export type CalendarRange = { from: string; to: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ringkasan singkat untuk tombol pemicu diambil dari
 * `formatRangeShort` di `@/lib/admin-calendar`.
 *
 * Awalnya fungsi ini ditulis di file ini. Test runner tidak bisa memuat
 * `.tsx`, jadi logikanya tidak bisa diuji di tempat ia hidup - dan
 * logika yang tak teruji pada teks yang selalu terlihat di laporan
 * adalah tempat yang salah untuk menaruh logika.
 */

function Month({
  year,
  month,
  from,
  to,
  onPick,
  onPrev,
  onNext,
  hideNav = false,
}: {
  year: number;
  month: number;
  from: string;
  to: string;
  onPick: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  /** Bulan kedua tidak punya navigasi sendiri - semuanya di bulan pertama. */
  hideNav?: boolean;
}) {
  const weeks = monthMatrix(year, month);

  return (
    <div className="acc-cal-month">
      {hideNav ? (
        <div className="acc-cal-nav">
          <span />
          <strong>
            {BULAN[month]} {year}
          </strong>
          <span />
        </div>
      ) : (
        <div className="acc-cal-nav">
          <button type="button" onClick={onPrev} aria-label="Bulan sebelumnya">
            &lt;
          </button>
          <strong>
            {BULAN[month]} {year}
          </strong>
          <button type="button" onClick={onNext} aria-label="Bulan berikutnya">
            &gt;
          </button>
        </div>
      )}

      <div className="acc-cal-grid acc-cal-head">
        {HARI.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="acc-cal-grid">
        {weeks.map((week) =>
          week.map((date) => {
            const key = toKey(date);
            const outside = date.getMonth() !== month;

            const isStart = key === from;
            const isEnd = key === to;
            const between = Boolean(from) && Boolean(to) && key > from && key < to;
            const inRange = Boolean(from) && Boolean(to) && key >= from && key <= to;

            return (
              <button
                key={key}
                type="button"
                data-outside={outside ? "true" : undefined}
                data-today={key === todayKey() ? "true" : undefined}
                className={
                  [
                    isStart || isEnd ? "edge" : "",
                    between ? "between" : "",
                    inRange ? "in-range" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onClick={() => onPick(key)}
              >
                {date.getDate()}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

export default function CalendarRangePicker({
  value,
  onApply,
  busy = false,
}: {
  value: CalendarRange;
  onApply: (next: CalendarRange) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const panelId = useId();
  const today = useMemo(() => new Date(), []);

  useDismissOnOutside(open, () => setOpen(false), rootRef);

  /*
   * Tanggal dipakai ulang dari setiap buka panel.
   *
   * Dulu state-nya hanya diisi sekali, saat komponen pertama kali
   * dirender. Kalau operator menekan "Tutup" lalu memilih preset lain,
   * panelnya masih menampilkanrentang lama - padahal tombol pemicunya
   * sudah menuliskan rentang yang baru. Dua angka berbeda untuk hal yang
   * sama, di layar yang sama.
   */
  function openPanel() {
    setFrom(value.from);
    setTo(value.to);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  const [cursor, setCursor] = useState(() => {
    const base = value.from ? fromKey(value.from) : today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  function pick(key: string) {
    /*
     * Geser kursor ke bulan yang memuat tanggal yang diklik.
     *
     * Tanpa ini, memilih tanggal di bulan kedua tidak mengubah apa pun
     * yang terlihat - tanggalnya terpilih, tapi kalender tetap
     * menampilkan dua bulan yang sama seperti sebelumnya. Kalau
     * operator lalu memilih tanggal kedua di bulan pertama, hasilnya
     * rentang yang melompati sebulan tanpa ada yang menyadarinya.
     *
     * Hanya bulan PERTAMA yang digeser, karena `cursor` mengatur kedua
     * bulan sekaligus.
     */
    const picked = fromKey(key);
    setCursor(new Date(picked.getFullYear(), picked.getMonth(), 1));

    if (!from || (from && to)) {
      // Mulai rentang baru.
      setFrom(key);
      setTo("");
      return;
    }
    // Kalender dibaca kiri ke kanan, tapi operator boleh salah klik
    // dan memilih tanggal yang lebih kecil. Menukarnya lebih baik
    // daripada menolak - menolak membuat orang mengira kalendernya
    // rusak.
    if (key < from) {
      setTo(from);
      setFrom(key);
      return;
    }
    setTo(key);
  }

  function shiftMonth(delta: number) {
    setCursor(
      (current) => new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  }

  const secondMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const valid = Boolean(from) && Boolean(to) && from <= to;
  const nights = valid
    ? Math.round((fromKey(to).getTime() - fromKey(from).getTime()) / DAY_MS) + 1
    : 0;
  const ringkas = formatRangeShort(value.from, value.to);

  return (
    <div className="acc-field acc-dtpicker acc-range-trigger" ref={rootRef}>
      <span id={panelId + "-label"}>Rentang tanggal</span>

      <button
        ref={triggerRef}
        type="button"
        className={"acc-dtpicker-trigger" + (ringkas ? " terisi" : "")}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={panelId + "-label"}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <span>{ringkas || "Pilih rentang tanggal"}</span>
        <span className="acc-dtpicker-caret" aria-hidden="true" />
      </button>

      <small>
        {valid
          ? `${nights} hari dipilih.`
          : "Klik tanggal awal, lalu tanggal akhir."}
      </small>

      {open ? (
        <div
          className="acc-dtpicker-pop acc-dtpicker-pop-wide"
          role="dialog"
          aria-label="Pilih rentang tanggal"
        >
          <div className="acc-calendar-months">
            <Month
              year={cursor.getFullYear()}
              month={cursor.getMonth()}
              from={from}
              to={to}
              onPick={pick}
              onPrev={() => shiftMonth(-1)}
              onNext={() => shiftMonth(1)}
            />
            <Month
              year={secondMonth.getFullYear()}
              month={secondMonth.getMonth()}
              from={from}
              to={to}
              onPick={pick}
              /*
               * Bulan kedua tidak punya tombol sendiri.
               *
               * Semula ada, dan keduanya memanggil `shiftMonth(1)` - jadi
               * menekan "<" di bulan kanan tidak mundur, justru maju.
               * Karena kedua bulan digerakkan oleh satu `cursor`, satu
               * pasang tombol sudah cukup: menggeser `cursor` bergerak
               * keduanya, dan dua bulan yang berdampingan selalu
               * berurutan.
               */
              hideNav
              onPrev={() => shiftMonth(-1)}
              onNext={() => shiftMonth(1)}
            />
          </div>

          <div className="acc-dtpicker-foot">
            <span>
              {!from
                ? "Klik tanggal awal."
                : !to
                  ? `Mulai ${formatKey(from)}. Klik tanggal akhir.`
                  : `${formatKey(from)} → ${formatKey(to)}`}
            </span>

            <div className="acc-dtpicker-foot-actions">
              <button
                type="button"
                className="acc-ghost-link"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                Kosongkan
              </button>

              <button
                type="button"
                className="acc-primary-link"
                disabled={!valid || busy}
                onClick={() => {
                  onApply({ from, to });
                  setOpen(false);
                }}
              >
                {busy ? "Memuat..." : "Terapkan rentang"}
              </button>
            </div>
          </div>

          <div className="acc-dtpicker-foot">
            <span />
            <button type="button" className="acc-inline-button" onClick={closePanel}>
              Tutup
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}