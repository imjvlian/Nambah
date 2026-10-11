"use client";

import { useMemo, useState } from "react";

/**
 * Pemilih rentang tanggal dengan kalender.
 *
 * KENAPA BUKAN `<input type="date">`
 *
 * Dua input tanggal bawaan browser terlihat seperti kotak teks
 * kosong yang harus diketik. Mengapa orang tidak tinggal klik ikon
 * kalendernya? Karena di banyak browser - terutama di ponsel - input
 * itu membuka kalender yang isinya melompong dari posisi yang tak
 * terduga, dan di desktop formatnya mengikuti locale sehingga
 * "01/11/2026" bisa berarti 1 November atau 11 Januari.
 *
 * Di laporan keuangan, salah membaca tanggal berarti laporan yang
 * terlihat sahih tapi salah. Jadi kalendernya dibuat sendiri: format
 * tanggal selalu terlihat di setiap sel, dan rentang yang dipilih
 * selalu tertulis lengkap di tombolnya.
 *
 * TIGA KEADAAN, BUKAN DUA
 *
 * 1. Belum ada tanggal awal - klik pertama menetapkan awal.
 * 2. Sudah ada awal, belum ada akhir - klik kedua menetapkan akhir.
 * 3. Sudah lengkap - klik berikutnya memulai rentang baru dari nol.
 *
 * Tanpa itu, memperbaiki satu tanggal yang keliru jadi ritual: hapus
 * keduanya dulu, baru pilih ulang.
 */

export type CalendarRange = { from: string; to: string };

const DAY_MS = 24 * 60 * 60 * 1000;

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** `YYYY-MM-DD` tanpa pergeseran timezone. */
function toKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parse `YYYY-MM-DD` sebagai tanggal LOKAL.
 *
 * `new Date("2026-01-31")` di-parse sebagai UTC tengah malam, lalu
 * di locale GMT+7 menjadi 31 Januari 08:00 - masih tanggal yang sama,
 * tapi di GMT-5 jadi 30 Januari. Hari yang bergeser satu hari di
 * kalender adalah cara paling cepat membuat orang salah memilih.
 */
function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Deret hari dalam satu bulan, mulai dari hari Minggu. */
function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  const weeks: Date[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    // Berhenti setelah minggu yang memuat tanggal 1 bulan berikutnya.
    if (cursor.getMonth() !== month && w >= 3) break;
  }
  return weeks;
}

function formatKey(key: string) {
  if (!key) return "-";
  const date = fromKey(key);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

function Month({
  year,
  month,
  from,
  to,
  onPick,
  onPrev,
  onNext,
}: {
  year: number;
  month: number;
  from: string;
  to: string;
  onPick: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const weeks = monthMatrix(year, month);

  return (
    <div className="acc-cal-month">
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
            const between =
              Boolean(from) && Boolean(to) && key > from && key < to;
            const inRange =
              Boolean(from) && Boolean(to) && key >= from && key <= to;

            return (
              <button
                key={key}
                type="button"
                data-outside={outside ? "true" : undefined}
                data-today={key === toKey(new Date()) ? "true" : undefined}
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
  onCancel,
}: {
  value: CalendarRange;
  onApply: (next: CalendarRange) => void;
  busy?: boolean;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);

  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => {
    const base = value.from ? fromKey(value.from) : today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  function pick(key: string) {
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

  return (
    <div className="acc-calendar">
      <div className="acc-calendar-head">
        <div>
          {from || to ? (
            <>
              <strong>{formatKey(from)}</strong>
              <span> &rarr; </span>
              <strong>{formatKey(to)}</strong>
              {valid ? <small> ({nights} hari)</small> : null}
            </>
          ) : (
            <strong>Pilih tanggal awal</strong>
          )}
        </div>
        <button type="button" className="acc-ghost-link" onClick={onCancel}>
          Tutup
        </button>
      </div>

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
          onPrev={() => shiftMonth(1)}
          onNext={() => shiftMonth(1)}
        />
      </div>

      <div className="acc-calendar-foot">
        <span>
          {!from
            ? "Klik tanggal awal."
            : !to
              ? `Mulai ${formatKey(from)}. Klik tanggal akhir.`
              : `${nights} hari dipilih.`}
        </span>
        <button
          type="button"
          className="acc-primary-link"
          disabled={!valid || busy}
          onClick={() => onApply({ from, to })}
        >
          {busy ? "Memuat..." : "Terapkan rentang"}
        </button>
      </div>
    </div>
  );
}