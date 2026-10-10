"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tombol salin teks dengan konfirmasi sebentar.
 *
 * Pola yang sama dipakai `FlashSaleStrip`, `OrderStatusView`,
 * `PromoBannerCarousel`, dan `PromoPopup` - dipakai bersama supaya
 * konfirmasi di lima tempat itu tidak mulai berbeda satu per satu.
 *
 * Detail yang penting:
 *
 * - `navigator.clipboard` hanya tersedia di secure context. Di `http://`
 *   atau browser yang menolak izin, `writeText` melempar. Itu TIDAK
 *   berarti gagal — teksnya masih bisa disalin manual, jadi tombolnya
 *   diam-diam kembali normal tanpa pesan error yang membingungkan.
 *
 * - `setTimeout` dibersihkan saat komponen turun. Tanpa itu, pindah
 *   halaman sebelum 2,5 detik akan memanggil setter pada komponen yang
 *   sudah tidak ada, dan React 18+ITTeringkas itu sebagai kebocoran
 *   state.
 */
export default function CopyButton({
  value,
  label = "Salin",
  copiedLabel = "Tersalin",
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void copy()}
      // `aria-live`, bukan `title`: pembaca layar mendengar
      // "Tersalin" tepat setelah tombol ditekan.
      aria-live="polite"
      title={copied ? copiedLabel : `Salin ${value}`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}