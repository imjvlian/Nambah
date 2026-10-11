"use client";

import { useId, useRef, useState } from "react";
import {
  BULAN,
  HARI,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  formatDateTime,
  formatKey,
  fromKey,
  hourForNewSchedule,
  joinDateTime,
  monthMatrix,
  splitDateTime,
  toKey,
  todayKey,
} from "@/lib/admin-calendar";
import { useDismissOnOutside } from "./useDismissOnOutside";

/**
 * Pemilih satu tanggal + jam, dalam panel dropdown.
 *
 * KENAPA BUKAN `<input type="datetime-local">`
 *
 * Input bawaan itu membawa dua masalah sekaligus:
 *
 * 1. Formatnya mengikuti locale, jadi "01/11/2026" bisa berarti 1 November
 *    atau 11 Januari. Untuk jadwal flash sale, salah baca berarti promo
 *    berjalan pada waktu yang tidak dimaksud - dan tidak ada yang
 *    mengetahuinya sampai campaign selesai.
 * 2. Jamnya berupa "hh:mm" tanpa keterangan zona waktu. Promo yang
 *   Operator jadwalkan jam 9 pagi bisa berarti 9 pagi di Jakarta atau
 *    2 pagi di server, tergantung mana yang mengonversi lebih dulu.
 *
 * Di sini tanggal selalu ditulis lengkap ("5 Januari 2026, 09:30") di
 * tombol pemicunya, jadi tidak ada yang perlu ditebak.
 *
 * SERAGAM DENGAN KALENDER LAPORAN
 *
 * Grid bulan, tombol navigasi, dan bentuk sel memakai kelas yang sama
 * dengan `CalendarRangePicker` (`.acc-cal-*`). Bedanya hanya bentuknya:
 * rentang memakai dua bulan sekaligus, sedangkan jadwal hanya satu bulan
 * dengan pengatur jam di bawahnya.
 *
 * Satu-satunya logika bersama ada di `@/lib/admin-calendar`, bukan di
 * komponen. Kalau helper tanggalnya diletakkan di salah satu komponen,
 * yang lain pasti akan menyalinnya dan keduanya akan berbeda di kasus
 * batas -ocale GMT negatif, tanggal 31, akhir bulan.
 */
export default function DateTimePicker({
  value,
  onChange,
  label,
  hint,
  minDate,
  disabled = false,
  placeholder = "Pilih tanggal",
}: {
  /** Nilai `datetime-local`: `YYYY-MM-DDTHH:mm`, atau `""`. */
  value: string;
  onChange: (next: string) => void;
  label: string;
  hint?: string;
  /** Kunci `YYYY-MM-DD` paling awal yang boleh dipilih. */
  minDate?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const parts = splitDateTime(value);
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const base = parts.date ? fromKey(parts.date) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /*
   * Tutup saat klik di luar, atau saat Escape - perilaku ini sekarang
   * hidup di `useDismissOnOutside`, dipakai bersama oleh kalender rentang
   * laporan. Kalau listener-nya ditulis ulang di sini, salah satunya pasti
   * akan lupa `Escape` atau lupa melepas listener.
   */
  useDismissOnOutside(open, () => {
    setOpen(false);
    // Fokus dikembalikan ke pemicu, supaya keyboard user tidak terjatuh
    // ke elemen acak di belakang panel yang baru tertutup.
    triggerRef.current?.focus();
  }, rootRef);

  function pickDay(key: string) {
    if (minDate && key < minDate) return;
    onChange(
      joinDateTime({
        date: key,
        // Jam yang sudah dipilih tetap dipakai; kalau belum ada, default
        // tengah malam - bukan tengah hari, karena promo yang dimulai
        // tengah malam berjalan 12 jam terlalu lama.
        hour: hourForNewSchedule(value),
        minute: parts.minute,
      }),
    );
  }

  function clear() {
    onChange("");
  }

  const weeks = monthMatrix(cursor.getFullYear(), cursor.getMonth());
  const today = todayKey();

  return (
    <div className="acc-field acc-dtpicker" ref={rootRef}>
      <span id={panelId + "-label"}>{label}</span>

      <button
        ref={triggerRef}
        type="button"
        className={"acc-dtpicker-trigger" + (parts.date ? " terisi" : "")}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={panelId + "-label"}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{parts.date ? formatDateTime(value) : placeholder}</span>
        <span className="acc-dtpicker-caret" aria-hidden="true" />
      </button>

      {hint ? <small>{hint}</small> : null}

      {open ? (
        <div className="acc-dtpicker-pop" role="dialog" aria-label={label}>
          <div className="acc-cal-nav">
            <button
              type="button"
              aria-label="Bulan sebelumnya"
              onClick={() =>
                setCursor(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              &lt;
            </button>
            <strong>
              {BULAN[cursor.getMonth()]} {cursor.getFullYear()}
            </strong>
            <button
              type="button"
              aria-label="Bulan berikutnya"
              onClick={() =>
                setCursor(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              &gt;
            </button>
          </div>

          <div className="acc-cal-grid acc-cal-head">
            {HARI.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="acc-cal-grid">
            {weeks.map((week) =>
              week.map((date) => {
                const key = toKey(date);
                const outside = date.getMonth() !== cursor.getMonth();
                const terblokir = Boolean(minDate) && key < (minDate as string);

                return (
                  <button
                    key={key}
                    type="button"
                    data-outside={outside ? "true" : undefined}
                    data-today={key === today ? "true" : undefined}
                    data-blocked={terblokir ? "true" : undefined}
                    className={key === parts.date ? "edge" : undefined}
                    disabled={terblokir}
                    onClick={() => pickDay(key)}
                  >
                    {date.getDate()}
                  </button>
                );
              }),
            )}
          </div>

          <div className="acc-dtpicker-time">
            <label className="acc-dtpicker-time-field">
              <span>Jam</span>
              <select
                value={parts.hour || hourForNewSchedule(value)}
                disabled={!parts.date}
                onChange={(event) =>
                  onChange(
                    joinDateTime({
                      date: parts.date,
                      hour: event.target.value,
                      minute: parts.minute,
                    }),
                  )
                }
              >
                {HOUR_OPTIONS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
            </label>

            <label className="acc-dtpicker-time-field">
              <span>Menit</span>
              <select
                value={parts.minute || "00"}
                disabled={!parts.date}
                onChange={(event) =>
                  onChange(
                    joinDateTime({
                      date: parts.date,
                      hour: parts.hour || hourForNewSchedule(value),
                      minute: event.target.value,
                    }),
                  )
                }
              >
                {MINUTE_OPTIONS.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="acc-dtpicker-foot">
            <span>
              {parts.date ? formatKey(parts.date) : "Belum ada tanggal"}
            </span>

            <div className="acc-dtpicker-foot-actions">
              {parts.date ? (
                <button
                  type="button"
                  className="acc-ghost-link"
                  onClick={() => {
                    clear();
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  Kosongkan
                </button>
              ) : null}

              {/*
                Tombol tutup yang selalu ada.

                Sebelumnya panel hanya menutup lewat klik di luar atau
                Escape. Untuk pengguna mouse itu tidak masalah - tapi
                panel ini menutupi field di bawahnya, dan "Kosongkan"
                ada di bagian paling bawah yang justru tertutup.
                Tanpa tombol yang terlihat, satu-satunya jalan
                adalah menebak-nebak letak tombolnya.

                Fokus dikembalikan ke pemicu supaya keyboard user tidak
                terjatuh ke elemen acak di belakang panel.
              */}
              <button
                type="button"
                className="acc-inline-button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}