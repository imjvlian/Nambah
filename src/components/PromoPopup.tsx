"use client";

import { useEffect, useState } from "react";

type Banner = {
  id: number;
  title: string;
  subtitle: string | null;
  imageUrl: string;
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
  const [copied, setCopied] = useState(false);

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

  if (!banner || !visible) return null;

  function close() {
    snooze(banner!.id);
    setVisible(false);
  }

  async function handleCta() {
    if (banner!.ctaHref) {
      snooze(banner!.id);
      window.open(banner!.ctaHref, "_blank", "noopener,noreferrer");
      setVisible(false);
      return;
    }
    if (banner!.promoCode) {
      try {
        await navigator.clipboard.writeText(banner!.promoCode);
        setCopied(true);
      } catch {
        setCopied(false);
      }
      snooze(banner!.id);
      setTimeout(() => {
        setVisible(false);
        document
          .getElementById("catalog-start")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 900);
      return;
    }
    snooze(banner!.id);
    setVisible(false);
    document
      .getElementById("catalog-start")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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

        {banner.showTextOverlay === false ? (
          // Mode bersih: gambar memenuhi popup, klik gambar menjalankan aksi
          // (link / salin kode / katalog), tanpa blok judul & tombol.
          <button
            type="button"
            className="promo-popup-media promo-popup-media-clean"
            style={{ backgroundImage: `url(${banner.imageUrl})` }}
            aria-label={banner.title}
            onClick={() => void handleCta()}
          />
        ) : (
          <>
            <div
              className="promo-popup-media"
              style={{ backgroundImage: `url(${banner.imageUrl})` }}
              role="img"
              aria-label={banner.title}
            />

            <div className="promo-popup-body">
              <strong>{banner.title}</strong>
              {banner.subtitle && <p>{banner.subtitle}</p>}
              <button type="button" className="promo-popup-cta" onClick={() => void handleCta()}>
                {copied
                  ? "Kode disalin ✓"
                  : banner.ctaLabel ??
                    (banner.promoCode ? `Pakai kode ${banner.promoCode}` : "Lihat promo")}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
