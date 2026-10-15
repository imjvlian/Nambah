"use client";

import { useEffect, useState } from "react";

import {
  imageAspectRatio,
  usableDimensions,
} from "@/lib/banner-display";

type Banner = {
  id: number;
  title: string;
  subtitle: string | null;
  popupMessage: string | null;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  promoCode: string | null;
  displayMode: string;
  showTextOverlay?: boolean;
};

const SNOOZE_MS = 24 * 60 * 60 * 1000;
const SNOOZE_PREFIX = "nambah_popup_snooze_";

function isSnoozed(bannerId: number) {
  try {
    const raw = window.localStorage.getItem(SNOOZE_PREFIX + bannerId);
    if (!raw) return false;
    return Date.now() - Number(raw) < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(bannerId: number) {
  try {
    window.localStorage.setItem(SNOOZE_PREFIX + bannerId, String(Date.now()));
  } catch {
    // localStorage tidak tersedia — popup cukup tidak ditampilkan lagi sesi ini.
  }
}

export default function PromoPopup() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [visible, setVisible] = useState(false);

  /*
   * Dimensi gambar yang ditampilkan.
   *
   * Disimpan karena popup harus tahu rasio SEBELUM gambar selesai dimuat.
   * Kalau tidak, kotak popup melompat dari tinggi sembarang ke tinggi
   * sebenarnya tepat di mata pengunjung - dan pada gambar potret lompatan
   * itu beberapa ratus piksel.
   *
   * Sumbernya berurutan: dimensi dari database, lalu dimensi asli dari
   * gambar yang baru dimuat untuk banner lama yang belum punya dimensi.
   */
  const [measured, setMeasured] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/banners", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { banners?: Banner[] } | null) => {
        if (!mounted) return;
        const popup = (data?.banners ?? []).find(
          (item) =>
            (item.displayMode === "popup" || item.displayMode === "both") &&
            !isSnoozed(item.id),
        );
        if (popup) {
          setBanner(popup);
          setVisible(true);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  /*
   * Ukuran yang dipakai di `<img width height>`.
   *
   * Dimensi dari database dipakai kalau ada. Kalau tidak - banner yang
   * diunggah sebelum migration 051 - dipakai hasil pengukuran di browser
   * setelah gambar dimuat. Tanpa fallback itu, gambar banner lama akan
   * melompat setiap kali popup muncul.
   */
  const dimensions = usableDimensions(banner?.imageWidth, banner?.imageHeight) ?? measured;

  const ratio = imageAspectRatio(
    dimensions?.width,
    dimensions?.height,
  );

  if (!banner || !visible) return null;

  function close() {
    snooze(banner!.id);
    setVisible(false);
  }

  const message = banner!.popupMessage?.trim() ?? "";
  const linkHref = banner!.ctaHref ?? "";
  const linkLabel = banner!.ctaLabel?.trim() || "Selengkapnya";

  return (
    <div className="promo-popup-backdrop" role="presentation" onClick={close}>
      <section
        className="promo-popup"
        role="dialog"
        aria-modal="true"
        aria-label={banner.title}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="promo-popup-close"
          aria-label="Tutup popup promo"
          onClick={close}
        >
          ✕
        </button>

        {/*
         * Gambar sebagai `<img>`, bukan `background-image`.
         *
         * Dengan background-image, browser tidak pernah tahu ukuran asli
         * gambarnya - yang dia lihat hanya kotak hasil CSS. Kotak itu
         * dipaksat rasio tetap, lalu `cover` memotong. Banner 1200x400 di
         * kotak 4/5 harus diperbesar jadi 1650px untuk memenuhi tinggi,
         * dan sekitar 73% lebarnya terpotong.
         *
         * Dengan `<img width height>`, browser memesan ruang yang tepat
         * SEBELUM gambar dimuat, lalu menampilkannya utuh. Rasio di style
         * hanya untuk saat browser belum punya dimensi - sisanya bukan
         * tebakan.
         */}
        <div
          className="promo-popup-media"
          style={ratio ? { aspectRatio: `${ratio}` } : undefined}
        >
          <img
            src={banner.imageUrl}
            alt={banner.title}
            width={dimensions?.width}
            height={dimensions?.height}
            decoding="async"
            onLoad={(event) => {
              const element = event.currentTarget;
              if (dimensions) return;
              if (!element.naturalWidth || !element.naturalHeight) return;
              setMeasured({
                width: element.naturalWidth,
                height: element.naturalHeight,
              });
            }}
          />
        </div>

        {/*
         * Tubuh popup hanya muncul kalau ada isi.
         *
         * Kalau pesan kosong dan tidak ada link, tidak ada kotak kosong di
         * bawah gambar - dan itu persis yang diminta: pop-up gambar
         * saja, tanpa teks, tanpa tombol. Nol elemen DOM yang tidak
         * melakukan apa-apa.
         */}
        {(message || linkHref) && (
          <div className="promo-popup-body">
            {message && <p className="promo-popup-message">{message}</p>}

            {linkHref && (
              <a
                className="promo-popup-link"
                href={linkHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                {linkLabel}
              </a>
            )}
          </div>
        )}
      </section>
    </div>
  );
}