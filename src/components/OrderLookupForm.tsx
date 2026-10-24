"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";

/**
 * Form pemulihan akses order (P4.2).
 *
 * Satu kolom kontak untuk email ATAU WhatsApp — pelanggan yang kehilangan
 * linknya sedang frustrasi; meminta mereka memilih "jenis kontak" dulu
 * adalah satu rintangan yang tidak perlu ada.
 *
 * Berhasil: pindah ke halaman order dengan token baru. Gagal: pesan
 * generik dari server (tidak membedakan order tidak ada vs kontak salah).
 */
export default function OrderLookupForm() {
  const [orderId, setOrderId] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/order-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderId, contact }),
      });
      const data = (await response.json()) as { orderUrl?: string; error?: string };
      if (!response.ok || !data.orderUrl) {
        setError(data.error ?? "Pencarian gagal. Coba lagi sebentar.");
        return;
      }
      window.location.assign(data.orderUrl);
    } catch {
      setError("Pencarian gagal. Coba lagi sebentar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cek-status-form" onSubmit={submit}>
      <label>
        <span>Order ID</span>
        <input
          value={orderId}
          onChange={(event) =>
            setOrderId(event.target.value.trim().toUpperCase())
          }
          placeholder="NBH-20261024-XXXXXXXXXX"
          autoCapitalize="characters"
          autoComplete="off"
          required
        />
        <small>
          Ada di bukti pembayaran Anda — formatnya NBH-tanggal-kode.
        </small>
      </label>

      <label>
        <span>Email atau WhatsApp saat checkout</span>
        <input
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="email@contoh.com atau 081234567890"
          autoComplete="off"
          required
        />
        <small>
          Kontak ini yang Anda isi sendiri di halaman pembayaran {BRAND.shortName}.
        </small>
      </label>

      <button type="submit" className="primary-button" disabled={busy}>
        {busy ? "Mencari..." : "Cari pesanan saya"}
      </button>

      {error && (
        <p className="cek-status-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
