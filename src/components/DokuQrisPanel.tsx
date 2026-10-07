"use client";

import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { formatIDR } from "@/lib/pricing";

export const DOKU_QRIS_PANEL_ID = "doku-qris-container";

export default function DokuQrisPanel({
  qrContent,
  amount,
  expiresAt,
}: {
  qrContent: string;
  amount: number;
  expiresAt?: string | null;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    toDataURL(qrContent, { margin: 1, width: 360 })
      .then((url) => {
        if (mounted) setDataUrl(url);
      })
      .catch(() => {
        if (mounted) setFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, [qrContent]);

  return (
    <div id={DOKU_QRIS_PANEL_ID} className="doku-qris-panel">
      <div className="doku-qris-frame">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="QRIS untuk pembayaran order ini" />
        ) : (
          <div className="doku-qris-loading">
            {failed ? "QR gagal dibuat. Muat ulang halaman." : "Memuat QR..."}
          </div>
        )}
      </div>
      <div className="doku-qris-meta">
        <strong>{formatIDR(amount)}</strong>
        <span>Scan dengan aplikasi pembayaran apa pun (GoPay, OVO, DANA, ShopeePay, mobile banking).</span>
        {expiresAt && (
          <small>
            QR berlaku sampai {new Date(expiresAt).toLocaleString("id-ID")}
          </small>
        )}
      </div>
    </div>
  );
}
