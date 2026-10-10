"use client";

import { useCallback, useState } from "react";

/**
 * Pratinjau HTML receipt tanpa mengirim email.
 *
 * Kenapa ini perlu ada: email yang sudah masuk inbox tidak bisa diedit dan
 * tidak bisa ditarik kembali. Satu kesalahan layout baru ketahuan setelah
 * pelanggan menerimanya. Pratinjau memanggil `renderReceiptHtml` yang sama
 * dengan pengiriman sungguhan, jadi yang terlihat di sini persis yang akan
 * diterima.
 *
 * Pratinjau ditampilkan lewat `srcDoc`, bukan `src` + iframe biasa.
 * Alasannya teknis, bukan estetika: `src` membuat browser memuat dokumen
 * dari origin sendiri, dan `frame-ancestors` pada CSP route itu akan
 * menolaknya. Dengan `srcDoc`, isinya menjadi dokumen milik panel admin —
 * tidak ada permintaan jaringan kedua, tidak ada origin baru.
 *
 * Isinya diambil lewat `fetch` yang sudah membawa cookie sesi admin, jadi
 * route preview tetap bisa menjaga itself dengan `authorizeAdminRequest`.
 */
export default function ReceiptPreview() {
  const [orderId, setOrderId] = useState("");
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const trimmed = orderId.trim();

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/receipt-preview?orderId=${encodeURIComponent(id)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );

      if (!response.ok) {
        // Endpoint mengembalikan JSON untuk error dan HTML untuk sukses.
        // Coba baca JSON dulu supaya pesan server sampai ke admin apa adanya.
        let message = `Preview gagal (HTTP ${response.status}).`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* body bukan JSON — pakai pesan default */
        }
        setError(message);
        setHtml("");
        return;
      }

      setHtml(await response.text());
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? `Preview gagal: ${fetchError.message}`
          : "Preview gagal dimuat.",
      );
      setHtml("");
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed) {
      setError("Masukkan order ID lebih dulu.");
      return;
    }
    void load(trimmed);
  };

  // Cmd/Ctrl+Enter = pratinjau tanpa menyentuh tombol. Form biasa
  // mengabaikan tombol Enter di dalam input, jadi tanpa handler eksplisit
  // pengguna harus pakai mouse.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (trimmed) void load(trimmed);
    }
  };

  return (
    <div className="acc-receipt-preview">
      <form className="acc-receipt-preview-form" onSubmit={submit}>
        <input
          value={orderId}
          onChange={(event) => {
            setOrderId(event.target.value);
            setError("");
          }}
          onKeyDown={onKeyDown}
          placeholder="Order ID, contoh: NBH-20261008-44BA21FB45"
          aria-label="Order ID untuk pratinjau receipt"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={!trimmed || loading}>
          {loading ? "Memuat" : "Pratinjau"}
        </button>
      </form>

      <p className="acc-receipt-preview-note">
        Pratinjau tidak mengirim email dan tidak mengubah status pengiriman.
        Order tidak harus berstatus <code>success</code> — status apa pun bisa
        diperiksa di sini. Tekan <code>Ctrl</code>/<code>Cmd</code> +
        <code>Enter</code> untuk pratinjau cepat.
      </p>

      {error && <p className="acc-error-text">{error}</p>}

      {html && (
        <div className="acc-receipt-preview-frame">
          <div className="acc-receipt-preview-bar">
            <span>Pratinjau · {trimmed}</span>
            <div className="acc-receipt-preview-actions">
              {/*
                Unduh lewat `<a download>`, bukan form POST.

                Berkas HTML-nya sudah ada di memori (state `html`) sebagai
                `srcDoc`, tapi `srcDoc` tidak bisa diunduh browser. Cara
                yang benar: biarkan browser meminta ulang ke endpoint yang
                sama dengan `download=1`. Endpoint itu mengembalikan
                `Content-Disposition: attachment`, jadi browser menyimpan
                berkas tanpa pernah menampilkannya.

                `href` dibangun ulang dari `trimmed` — bukan dari state
                `html` — supaya isinya persis sama dengan yang baru saja
                dirender.
              */}
              <a
                href={`/api/admin/receipt-preview?orderId=${encodeURIComponent(trimmed)}&download=1`}
                download
              >
                Unduh
              </a>
              <button type="button" onClick={() => setHtml("")}>
                Tutup
              </button>
            </div>
          </div>
          <iframe
            title={`Pratinjau receipt ${trimmed}`}
            srcDoc={html}
            className="acc-receipt-preview-iframe"
          />
        </div>
      )}
    </div>
  );
}