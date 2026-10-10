"use client";

import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";

/**
 * QR + kode pendek untuk order ritel.
 *
 * HANYA dirender untuk order yang punya `merchantScanCode` - yaitu order
 * `merchant_retail`. Order Midtrans/DOKU tidak punya kasir yang menunggu di
 * seberang konter, jadi tidak ada gunanya menampilkan kode yang tidak akan
 * pernah dipindai siapa pun.
 *
 * Kode pendek ditampilkan sebagai TEKS di bawah QR, bukan cuma di dalam
 * gambar. Tiga alasan:
 *
 * 1. Kamera bisa gagal - lalu kasir harus mengetik manual, dan mengetik dari
 *    gambar QR mustahil.
 * 2. Pelanggan sering tidak punya HP yang bisa scan QR dengan benar di konter.
 * 3. Kode hanya 8 karakter. Membacanya keras-keras jauh lebih cepat daripada
 *    memindai.
 */
export default function MerchantScanCode({
  code,
  amount,
}: {
  code: string;
  amount: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    toDataURL(code, { margin: 1, width: 220, errorCorrectionLevel: "M" })
      .then((url) => {
        if (mounted) setDataUrl(url);
      })
      .catch(() => {
        // Kegagalan render QR TIDAK boleh menyembunyikan kode teksnya -
        // justru di saat seperti inilah kode teks yang menyelamatkan.
        if (mounted) setFailed(true);
      });

    return () => {
      mounted = false;
    };
  }, [code]);

  const formatted = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);

  return (
    <div className="merchant-scan">
      <div className="merchant-scan-head">
        <strong>Tunjukkan layar ini ke kasir</strong>
        <small>Pembayaran sudah diterima di toko</small>
      </div>

      {failed ? null : dataUrl ? (
        <img className="merchant-scan-qr" src={dataUrl} alt={`Kode pesanan ${code}`} />
      ) : (
        <div className="merchant-scan-qr merchant-scan-qr-skeleton" />
      )}

      <div className="merchant-scan-code">{code}</div>
      <div className="merchant-scan-amount">{formatted}</div>
    </div>
  );
}