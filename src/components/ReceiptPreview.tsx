"use client";

import { useState } from "react";

/**
 * Pratinjau HTML receipt tanpa mengirim email.
 *
 * Kenapa ini perlu ada: email yang sudah masuk inbox tidak bisa diedit dan
 * tidak bisa ditarik kembali. Satu kesalahan layout baru ketahuan setelah
 * pelanggan menerimanya. Pratinjau memakai endpoint yang memanggil
 * `renderReceiptHtml` yang sama dengan pengiriman sungguhan, jadi yang
 * terlihat di sini persis yang akan diterima.
 *
 * Pratinjau dibuka di iframe, bukan disisipkan langsung ke DOM admin.
 * Alasannya bukan tampilan: HTML receipt penuh dengan CSS inline dan
 * atribut yang tidak berguna di dalam konteks panel admin, dan menyisipkannya
 * akan membuat gaya panel ikut mewarisi hal-hal yang tidak relevan.
 */
export default function ReceiptPreview() {
  const [orderId, setOrderId] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const trimmed = orderId.trim();
  const previewHref = trimmed
    ? `/api/admin/receipt-preview?orderId=${encodeURIComponent(trimmed)}`
    : "";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed) {
      setError("Masukkan order ID lebih dulu.");
      return;
    }
    setError("");
    setOpen(true);
  };

  return (
    <div className="acc-receipt-preview">
      <form
        className="acc-receipt-preview-form"
        onSubmit={submit}
      >
        <input
          value={orderId}
          onChange={(event) => {
            setOrderId(event.target.value);
            setError("");
          }}
          placeholder="Order ID, contoh: ORD-2409-8F2A91C4"
          aria-label="Order ID untuk pratinjau receipt"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={!trimmed}>
          Pratinjau
        </button>
      </form>

      <p className="acc-receipt-preview-note">
        Pratinjau tidak mengirim email dan tidak mengubah status pengiriman.
        Order tidak harus <code>success</code> — status apa pun bisa
        diperiksa di sini.
      </p>

      {error && <p className="acc-error-text">{error}</p>}

      {open && previewHref && (
        <div className="acc-receipt-preview-frame">
          <div className="acc-receipt-preview-bar">
            <span>Pratinjau · {trimmed}</span>
            <button type="button" onClick={() => setOpen(false)}>
              Tutup
            </button>
          </div>
          {/*
            `sandbox` mengizinkan HTML & script tapi TIDAK `allow-same-origin`.
            Tanpa itu, isi iframe berjalan di origin yang sama dengan panel
            admin dan bisa menyentuh cookie sesi. Ini bukan Style, ini
           batas keamanan untuk konten yang datanya berasal dari input
            pengguna (`order_id`, nama game, label produk).
          */}
          <iframe
            title={`Pratinjau receipt ${trimmed}`}
            src={previewHref}
            sandbox="allow-same-origin"
            className="acc-receipt-preview-iframe"
          />
        </div>
      )}
    </div>
  );
}