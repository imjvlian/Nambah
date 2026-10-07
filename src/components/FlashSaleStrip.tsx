"use client";

import { useEffect, useMemo, useState } from "react";

type PublicPromotion = {
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number;
  endsAt: string | null;
};

function benefitLabel(promo: PublicPromotion) {
  return promo.type === "percentage"
    ? `Hemat ${promo.value}%`
    : `Potongan Rp${promo.value.toLocaleString("id-ID")}`;
}

function countdownLabel(endsAt: string, now: number) {
  const remaining = new Date(endsAt).getTime() - now;
  if (remaining <= 0) return null;
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds >= 24 * 3600) {
    const days = Math.floor(totalSeconds / (24 * 3600));
    const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    return `${days}h ${hours}j`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export default function FlashSaleStrip() {
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch("/api/banners", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { promotions?: PublicPromotion[] } | null) => {
        if (!mounted) return;
        setPromotions(data?.promotions ?? []);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Countdown hanya berdetak kalau ada promo berbatas waktu.
  const hasTimedPromo = useMemo(
    () => promotions.some((promo) => promo.endsAt),
    [promotions],
  );

  useEffect(() => {
    if (!hasTimedPromo) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasTimedPromo]);

  const visible = promotions.filter((promo) => {
    if (!promo.endsAt) return true;
    return new Date(promo.endsAt).getTime() > now;
  });

  if (visible.length === 0) return null;

  async function useCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(""), 2500);
    } catch {
      setCopied("");
    }
    document
      .getElementById("catalog-start")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="flash-sale-strip shell" aria-label="Promo aktif">
      <div className="flash-sale-strip-track">
        {visible.map((promo) => {
          const countdown = promo.endsAt ? countdownLabel(promo.endsAt, now) : null;
          return (
            <article className="flash-sale-chip" key={promo.code}>
              <span className="flash-sale-flag">Flash sale</span>
              <div className="flash-sale-info">
                <strong>{promo.name}</strong>
                <span>
                  {benefitLabel(promo)} · kode <b>{promo.code}</b>
                </span>
              </div>
              {countdown && (
                <span className="flash-sale-countdown" aria-label="Sisa waktu promo">
                  {countdown}
                </span>
              )}
              <button
                type="button"
                className="flash-sale-use"
                onClick={() => void useCode(promo.code)}
              >
                {copied === promo.code ? "Disalin ✓" : "Pakai"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
