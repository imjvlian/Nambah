"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Panel yang isinya tertutup sampai operator membukanya.
 *
 * KENAPA DIBAWAIN
 *
 * Tiga halaman admin punya form yang SELALU terbuka: buat toko (6
 * field), buat campaign promo (5 field), dan alat penyesuaian harga
 * massal (4 field). Semuanya tampil sebelum operator melihat satu
 * pun data yang ingin ia cari.
 *
 * Masalahnya bukan panelnya yang panjang. Masalahnya adalah dua
 * pertanyaan berbeda yang ditampilkan berdampingan: "cari produk ini"
 * dan "bikin toko baru". Keduanya tidak punya urutan, jadi operator
 * selalu melewati form yang tidak akan ia sentuh.
 *
 * Yang paling mahal adalah alat penyesuaian harga massal. Tombolnya
 * mengubah harga banyak produk sekaligus, dan tadinya berdiri di baris
 * yang sama dengan kotak pencarian - level visual yang sama untuk
 * "cari" dan "ubah harga 200 produk". Tombol kedua itu lebih
 * berbahaya daripada yang pertama, dan tampilannya tidak menyatakan hal itu.
 *
 * BUKAN `<details>`
 *
 * `<details>` bawaan tidak bisa dikendalikan penuh: tidak ada callback
 * untuk tahu kapan panel dibuka, jadi halaman tidak bisa menampilkan
 * peringatan "ada perubahan belum disimpan" saat panel ditutup.
 * Elemen server juga tidak bisa diberi gaya yang konsisten di semua
 * browser.
 */
export default function CollapsiblePanel({
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: {
  /** Judul yang selalu terlihat, termasuk saat panel tertutup. */
  title: string;
  description?: string;
  /** Penanda di sebelah judul, mis. jumlah field terisi. */
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className={open ? "acc-collapsible open" : "acc-collapsible"}>
      <button
        type="button"
        className="acc-collapsible-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="acc-collapsible-chevron" aria-hidden="true" />
        <span className="acc-collapsible-text">
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </span>
        {badge !== undefined && badge !== null ? (
          <span className="acc-collapsible-badge">{badge}</span>
        ) : null}
      </button>

      {/*
        `hidden` dipakai, bukan disembunyikan lewat CSS saja: elemen yang
        tetap di DOM tapi `display: none` masih bisa diambil fokusnya
        lewat Tab di sebagian browser, jadi operator bisa mengetik ke
        form yang tidak terlihat.
      */}
      <div className="acc-collapsible-body" id={panelId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}