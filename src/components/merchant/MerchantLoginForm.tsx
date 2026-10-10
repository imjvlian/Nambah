"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Form login toko ritel.
 *
 * Setelah berhasil, halaman dimuat ulang dengan `router.refresh()`, bukan
 * `router.push("/merchant")`. Alasannya: `/merchant` adalah Server Component
 * yang membaca cookie sesi, dan `push` ke URL yang sedang aktif tidak
 * selalu menjalankan ulang server component-nya - jadi user bisa melihat
 * form login lagi tepat setelah login berhasil.
 */
export function MerchantLoginForm() {
  const router = useRouter();
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

      router.refresh();
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