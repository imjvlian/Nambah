"use client";

import { useState } from "react";
import { toKey } from "@/lib/admin-calendar";
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

  /*
   * Angka hari pada preset, dipakai untuk mengisi kalender rentang dengan
   * rentang yang masuk akal begitu mode rentang dibuka.
   *
   * Dihitung dari "hari ini", bukan dari tanggal server. Selisihnya
   * paling satu hari di sekitar tengah malam, dan keuntungannya kalender
   * langsung terisi dengan sesuatu yang masuk akal - yang jauh lebih
   * berguna daripada kalender kosong yang harus diisi dari nol.
   */
  function defaultRangeFor(preset: string) {
    const days = presets.find((p) => p.value === preset)?.value;
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (Number(days || 30) - 1));
    /*
     * `toISOString()` yang dipakai sebelumnya mengembalikan UTC, bukan
     * waktu lokal.
     *
     * Di GMT+7, `new Date()` hari ini pukul 02:00 adalah kemarin pukul
     * 19:00 UTC - jadi `toISOString().slice(0, 10)` mengembalikan
     * KEMARIN. Preset "hari ini" jadi laporan kemarin, dan preset
     * "30 hari" kehilangan satu hari di ujungnya.
     *
     * Tidak ada error, tidak ada peringatan: angkanya masuk ke query dan
     * laporan termuat dengan hasil yang terlihat benar.
     *
     * `toKey` dari `@/lib/admin-calendar` menulis tanggal waktu lokal,
     * sama dengan yang dipakai grid kalender di bawah - jadi angka di
     * tombol preset dan angka di kalender selalu sama.
     */
    return {
      from: toKey(start),
      to: toKey(end),
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
              setCustom(false);
              onApply({ preset: preset.value, ...defaultRangeFor(preset.value) });
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          className={custom ? "active" : ""}
          onClick={() => setCustom((current) => !current)}
        >
          Rentang
        </button>
      </div>

      {/*
          Kalendernya sekarang sendiri yang menyimpan status buka/tutup,
          jadi pemanggil tidak perlu memanggil apa pun. Dulu ada `onCancel`
          yang memanggil `setCustom(false)` - sekarang "Tutup" hanya
          menutup panel, dan tombol "Rentang" di baris preset tetap menyala.

          Bedanya penting: menutup panel bukan berarti membatalkan pilihan
          periode. Kalau "Tutup" ikut menonaktifkan mode rentang, operator
          yang mau melihat lagi tanggal pilihannya harus menekan "Rentang"
          lagi - dan kolomnya menghilang di antaranya.

          `from`/`to` lokal juga sudah tidak perlu: panel diisi ulang dari
          `value.from`/`value.to` setiap kali dibuka, jadi satu-satunya
          sumber kebenaran adalah rentang yang benar-benar sedang dipakai
          laporan.
        */}
        {custom ? (
          <CalendarRangePicker
            value={{
              from: value.preset ? "" : value.from,
              to: value.preset ? "" : value.to,
            }}
            busy={busy}
            onApply={(range) => onApply({ preset: "", ...range })}
          />
        ) : null}
    </div>
  );
}