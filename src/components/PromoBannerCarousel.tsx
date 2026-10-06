"use client";

import { useEffect, useRef, useState } from "react";

type Banner = {
  id: number;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  promoCode: string | null;
};

type PublicPromotion = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number;
  endsAt: string | null;
};

type Slide =
  | { kind: "banner"; banner: Banner }
  | { kind: "promo"; promo: PublicPromotion }
  | { kind: "usp"; title: string; copy: string };

const USP_SLIDES: Slide[] = [
  {
    kind: "usp",
    title: "Top up cepat, 24/7.",
    copy: "Pilih produk, bayar, pesanan diproses otomatis.",
  },
  {
    kind: "usp",
    title: "Pembayaran simpel & aman.",
    copy: "Harga divalidasi sebelum checkout, status selalu terlacak.",
  },
];

function promoValueLabel(promo: PublicPromotion) {
  return promo.type === "percentage"
    ? `Hemat ${promo.value}%`
    : `Potongan Rp${promo.value.toLocaleString("id-ID")}`;
}

export default function PromoBannerCarousel() {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState("");
  const hoverRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    fetch("/api/banners", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { banners?: Banner[]; promotions?: PublicPromotion[] } | null) => {
        if (!mounted) return;
        const bannerSlides: Slide[] = (data?.banners ?? []).map((banner) => ({
          kind: "banner",
          banner,
        }));
        const promoSlides: Slide[] = (data?.promotions ?? []).map((promo) => ({
          kind: "promo",
          promo,
        }));
        setSlides(
          bannerSlides.length > 0
            ? [...bannerSlides, ...promoSlides]
            : promoSlides.length > 0
              ? promoSlides
              : USP_SLIDES,
        );
      })
      .catch(() => {
        if (mounted) setSlides(USP_SLIDES);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!slides || slides.length < 2) return;
    const timer = setInterval(() => {
      if (!hoverRef.current) {
        setIndex((current) => (current + 1) % slides.length);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [slides]);

  if (!slides) return null;

  const slide = slides[index % slides.length]!;

  async function handleCta() {
    if (slide.kind === "banner") {
      const { banner } = slide;
      if (banner.ctaHref) {
        window.open(banner.ctaHref, "_blank", "noopener,noreferrer");
        return;
      }
      if (banner.promoCode) {
        await copyCode(banner.promoCode);
        return;
      }
      scrollToCatalog();
      return;
    }
    if (slide.kind === "promo") {
      await copyCode(slide.promo.code);
      return;
    }
    scrollToCatalog();
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(""), 2500);
    } catch {
      setCopied("");
    }
    scrollToCatalog();
  }

  function scrollToCatalog() {
    document
      .getElementById("catalog-start")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section
      className="promo-carousel shell"
      aria-label="Promo dan pengumuman"
      onMouseEnter={() => (hoverRef.current = true)}
      onMouseLeave={() => (hoverRef.current = false)}
    >
      <div className="promo-carousel-frame">
        {slide.kind === "banner" ? (
          <article
            className="promo-slide promo-slide-banner"
            style={{ backgroundImage: `url(${slide.banner.imageUrl})` }}
          >
            <div className="promo-slide-overlay">
              <div className="promo-slide-copy">
                <strong>{slide.banner.title}</strong>
                {slide.banner.subtitle && <p>{slide.banner.subtitle}</p>}
              </div>
              <button type="button" className="promo-slide-cta" onClick={() => void handleCta()}>
                {slide.banner.ctaLabel ??
                  (slide.banner.promoCode ? `Pakai kode ${slide.banner.promoCode}` : "Top up sekarang")}
              </button>
            </div>
          </article>
        ) : slide.kind === "promo" ? (
          <article className="promo-slide promo-slide-generic">
            <div className="promo-slide-copy">
              <span className="promo-slide-eyebrow">Kode promo aktif</span>
              <strong>{slide.promo.name}</strong>
              <p>
                {promoValueLabel(slide.promo)} · kode <b>{slide.promo.code}</b>
              </p>
            </div>
            <button type="button" className="promo-slide-cta" onClick={() => void handleCta()}>
              {copied === slide.promo.code ? "Kode disalin ✓" : "Pakai kode"}
            </button>
          </article>
        ) : (
          <article className="promo-slide promo-slide-generic">
            <div className="promo-slide-copy">
              <span className="promo-slide-eyebrow">Nambah</span>
              <strong>{slide.title}</strong>
              <p>{slide.copy}</p>
            </div>
            <button type="button" className="promo-slide-cta" onClick={() => void handleCta()}>
              Top up sekarang
            </button>
          </article>
        )}
      </div>

      {slides.length > 1 && (
        <div className="promo-carousel-dots" role="tablist" aria-label="Pilih banner">
          {slides.map((item, dotIndex) => (
            <button
              key={dotIndex}
              type="button"
              role="tab"
              aria-selected={dotIndex === index % slides.length}
              className={dotIndex === index % slides.length ? "active" : ""}
              onClick={() => setIndex(dotIndex)}
            >
              <span className="sr-only">
                Slide {dotIndex + 1}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
