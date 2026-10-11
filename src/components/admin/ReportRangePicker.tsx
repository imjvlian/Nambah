"use client";

import { useState } from "react";
import CalendarRangePicker from "@/components/admin/CalendarRangePicker";

/**
 * Pemilih periode untuk laporan: preset atau rentang tanggal bebas.
 *
 * KENAPA INI KOMPONEN, BUKAN DUA BLOK KODE
 *
 * Laporan Transaksi dan Arus Kas memakai definisi periode yang sama
 * (`resolveReportRange`). Dulu keduanya hanya punya tombol preset, jadi
 * satu-satunya cara melihat periode tertentu adalah menghitung sendiri
 * tanggal berapa yang harus diklik - dan tidak ada cara sama sekali
 * melihat satu bulan tertentu tanpa menghitung ulang preset.
 *
 * Dua salinan komponen ini akan menyimpang dalam sebulan. Bedanya di
 * sini bukan gaya, tapi makna.
 *
 * TANGGAL DIISI DI AWAL, TIDAK KOSONG
 *
 * Kolomnya langsung diisi rentang preset yang sedang aktif. Kalau
 * dibiarkan kosong, operator melihat dua kotak kosong dan tidak tahu
 * harus diisi apa - dan menebak tanggal yang salah menghasilkan laporan
 * yang terlihat sahih tapi salah periode.
 *
 * Tanggal yang diketik BELUM langsung memuat. Laporan bisa berat
 * (puluhan ribu baris), jadi pemuatan waited sampai operator menekan
 * Terapkan. Yang berubah di-state hanya apa yang akan di-request.
 */

export type ReportRangeValue = {
  /** `""` berarti sedang memakai preset. */
  preset: string;
  /** `YYYY-MM-DD`. */
  from: string;
  /** `YYYY-MM-DD`. */
  to: string;
};

type Preset = { value: string; label: string };

export default function ReportRangePicker({
  presets,
  value,
  onApply,
  busy = false,
  idPrefix,
  label = "Periode laporan",
}: {
  presets: readonly Preset[];
  value: ReportRangeValue;
  /** Dipanggil saat operator menekan Terapkan atau memilih preset. */
  onApply: (next: ReportRangeValue) => void;
  busy?: boolean;
  /** Prefix unik, dipakai untuk `id` label dan `htmlFor`. */
  idPrefix: string;
  label?: string;
}) {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);

  /*
   * Angka hari pada preset, untuk mengisi kolom tanggal saat operator
   * beralih ke mode rentang bebas.
   *
   * Dihitung dari "hari ini", bukan dari tanggal server. Selisihnya
   * paling satu hari di sekitar tengah malam, dan keuntungannya kolom
   * tanggal langsung terisi dengan sesuatu yang masuk akal - yang jauh
   * lebih berguna daripada kotak kosong.
   */
  function defaultRangeFor(preset: string) {
    const days = presets.find((p) => p.value === preset)?.value;
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (Number(days || 30) - 1));
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  }

  const activePreset = custom ? "" : value.preset;

  return (
    <div className="acc-range-picker">
      <div className="acc-segmented" role="group" aria-label={label}>
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            aria-pressed={activePreset === preset.value}
            className={activePreset === preset.value ? "active" : ""}
            onClick={() => {
              const filled = defaultRangeFor(preset.value);
              setCustom(false);
              setFrom(filled.from);
              setTo(filled.to);
              onApply({ preset: preset.value, from: filled.from, to: filled.to });
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          className={custom ? "active" : ""}
          onClick={() => {
            setCustom(true);
            const filled = defaultRangeFor(value.preset);
            if (!from) setFrom(filled.from);
            if (!to) setTo(filled.to);
          }}
        >
          Rentang
        </button>
      </div>

      {custom ? (
        <CalendarRangePicker
          value={{ from, to }}
          busy={busy}
          onApply={(range) => onApply({ preset: "", ...range })}
          onCancel={() => setCustom(false)}
        />
      ) : null}
    </div>
  );
}