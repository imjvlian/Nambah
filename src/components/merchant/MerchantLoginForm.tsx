"use client";

import { useState } from "react";

/**
 * Form login toko ritel.
 *
 * Setelah berhasil, halaman dimuat ulang dengan navigasi keras
 * (`window.location.assign`), bukan `router.refresh()` atau
 * `router.push`. Alasannya dijelaskan di dalam `submit`.
 */
export function MerchantLoginForm() {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/merchant/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pin }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Kode toko atau PIN salah.");
        setBusy(false);
        return;
      }

      /*
       * Navigasi keras, bukan `router.refresh()`.
       *
       * Alasannya nyata: `refresh()` hanya meminta ulang payload RSC dan
       * hopesikan server menukar form dengan menu. Kalau cookie sesinya tidak
       * terpakai - mis. ditolak browser, atau header `Set-Cookie` tidak
       * sampai - server mengembalikan form lagi, dan yang terjadi di layar
       * hanya form yang sama dengan tombol yang tetap nonaktif.
       *
       * `window.location.assign()` memuat ulang dokumen dari nol. Server
       * pasti membaca cookie yang baru saja disimpan, jadi hasilnya benar
       * atau ada error yang terlihat - tidak ada keadaan setengah jalan
       * yang tidak bisa dijelaskan.
       */
      setBusy(false);
      window.location.assign("/merchant");
    } catch {
      setError("Tidak bisa menghubungi server.");
      setBusy(false);
    }
  }

  return (
    <form className="merchant-portal-form" onSubmit={submit}>
      <label className="merchant-portal-field">
        <span>Kode toko</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
      </label>

      <label className="merchant-portal-field">
        <span>PIN kasir</span>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error ? (
        <p className="merchant-portal-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="merchant-portal-submit"
        type="submit"
        disabled={busy || !code.trim() || !pin}
      >
        {busy ? "Memeriksa..." : "Masuk"}
      </button>
    </form>
  );
}