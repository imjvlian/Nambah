"use client";

import { useEffect, useRef } from "react";

/**
 * Slot iklan kecil di order summary (P4.5) — unit Google AdSense (opsi A
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
 * Sumber nilainya env yang dibaca saat build (lihat .env.local):
 *   NEXT_PUBLIC_ADSENSE_CLIENT             ca-pub-... (wajib)
 *   NEXT_PUBLIC_ADSENSE_SLOT_ORDER_SUMMARY id ad unit angka (wajib agar
 *                                          unit dirender)
 * Kalau salah satu kosong, slot TIDAK dirender: meminta iklan ke Google
 * dengan client/slot kosong hanya menghasilkan error di console dan kotak
 * kosong bagi pelanggan.
 *
 * Loader script-nya <AdSenseScript /> yang dipasang root layout dengan
 * nonce per-request — CSP production memakai 'strict-dynamic'
 * (lihat src/lib/csp.ts).
 */

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

export default function OrderSummaryAdSlot() {
  const pushed = useRef(false);

  useEffect(() => {
    // Loader AdSense dimuat async — sebelum ia hidup, push dari komponen
    // ini masuk ke antrean window.adsbygoogle dan diproses begitu loader
    // siap; setelah itu push baru dirender langsung. Ref menjaga React
    // StrictMode (dev) tidak melakukan push dobel ke <ins> yang sama.
    if (pushed.current) return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Iklan bersifat opsional; kegagalan loader bukan sesuatu yang
      // perlu dipermasalahkan ke pelanggan yang baru selesai bayar.
    }
  }, []);

  const adClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const adSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_ORDER_SUMMARY;
  if (!adClient || !adSlot) return null;

  return (
    <div className="order-summary-ad" aria-label="Iklan">
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%" }}
        data-ad-client={adClient}
        data-ad-slot={adSlot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
