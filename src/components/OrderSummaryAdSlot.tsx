"use client";

import { useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";
import type { PublicPromotion } from "@/lib/public-promotions";

/**
 * Slot iklan kecil di order summary (P4.5) — versi house-ad (opsi B
 * di plan order-summary-ad-slot.md).
 *
 * Aturan yang ditegakkan komponen ini (dari plan):
 *   - 1 slot per halaman (dipasang sekali di OrderStatusView);
 *   - hanya dirender untuk status `success` / `awaiting_receivable`
 *     (dipasang oleh pemanggilnya);
 *   - tanpa popup, tanpa interstitial, tanpa auto-play;
 *   - tidak menutupi Order ID, SN, total, atau tombol aksi — letaknya
 *     paling bawah sticky card, di bawah rating form.
 *
 * ISI slot untuk sekarang: promo internal yang sedang jalan (ambil
 * yang pertama dari daftar aktif) — konten yang benar-benar berguna,
 * bukan filler. Tanpa promo aktif, slot TIDAK dirender: banner kosong
 * mengganggu dan tidak menghasilkan apa-apa.
 *
 * SEAM ADSENSE: kalau akun AdSense sudah siap, isi JSX di bawah (antara
 * penanda SEAM) diganti unit `order-summary-small` + ads.txt + CSP
 * domain Google (lihat plan §6 opsi A). Pemanggil dan aturan status
 * tidak berubah.
 */
export default function OrderSummaryAdSlot() {
  const [promo, setPromo] = useState<PublicPromotion | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/promo", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          promotions?: PublicPromotion[];
        };
        if (!active) return;
        // Slot satu promosi: yang pertama dari daftar sudah cukup —
        // daftar lengkap ada di halaman /promo.
        setPromo(data.promotions?.[0] ?? null);
      } catch {
        // Iklan bersifat opsional; kegagalan jaringan bukan masalah
        // yang perlu diperlihatkan ke pelanggan yang baru selesai bayar.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!loaded || !promo) return null;

  return (
    <div className="order-summary-ad" aria-label="Promo untuk Anda">
      {/* ── SEAM ADSENSE: mulai isi house-ad ─────────────────────────── */}
      <small>Promo berikutnya</small>
      <div className="order-summary-ad-body">
        <div>
          <strong>{promo.benefitText}</strong>
          <span>
            {promo.name} ·{" "}
            <a href="/promo" className="order-summary-ad-link">
              lihat semua promo
            </a>
          </span>
        </div>
        <span className="order-summary-ad-code">
          <code>{promo.code}</code>
          <CopyButton value={promo.code} label="Salin" copiedLabel="Tersalin" />
        </span>
      </div>
      {/* ── SEAM ADSENSE: selesai isi house-ad ────────────────────────── */}
    </div>
  );
}
