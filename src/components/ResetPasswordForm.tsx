"use client";

import { FormEvent, useEffect, useState } from "react";
import PasswordField from "@/components/PasswordField";
import PasswordMeter from "@/components/PasswordMeter";
import { assessPassword } from "@/lib/password-strength";

type ResetState = "loading" | "ready" | "invalid";

/**
 * Completes a password reset from the emailed link.
 *
 * Supabase hands the recovery session to the browser in the URL fragment,
 * after the "#". Fragments are never sent to a server, so this component is
 * the first thing able to see the tokens. It reads them once, hands them to
 * the reset endpoint, and then scrubs the fragment so the tokens do not stay
 * in the address bar or in browser history.
 */
export default function ResetPasswordForm() {
  const [state, setState] = useState<ResetState>("loading");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const access = fragment.get("access_token") ?? "";
    const refresh = fragment.get("refresh_token") ?? "";

    if (!access || !refresh) {
      setState("invalid");
      return;
    }

    setAccessToken(access);
    setRefreshToken(refresh);
    setState("ready");

    // Drop the tokens from the visible URL before anything else can leak
    // them into a screenshot, a referrer header or the back button.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const requirementsMet =
    password.length > 0 && assessPassword(password).requirementsMet;

  const mismatch =
    confirmTouched &&
    confirmPassword.length > 0 &&
    confirmPassword !== password;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          accessToken,
          refreshToken,
          password,
          confirmPassword,
        }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Password belum dapat disimpan.");
        return;
      }

      window.location.href = "/account";
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="auth-card">
        <div className="auth-card-head">
          <h1>Memeriksa tautan...</h1>
        </div>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="auth-card">
        <div className="auth-card-head">
          <span className="eyebrow">Lupa password</span>
          <h1>Tautan tidak berlaku.</h1>
          <p>
            Tautan pengaturan ulang sudah dipakai atau kedaluwarsa. Minta
            tautan baru untuk melanjutkan.
          </p>
        </div>
        <a className="primary-button auth-submit" href="/lupa-password">
          Minta tautan baru
          <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-card-head">
        <span className="eyebrow">Lupa password</span>
        <h1>Buat password baru.</h1>
        <p>Password baru harus mengikuti aturan yang sama dengan pendaftaran.</p>
      </div>

      <div className="auth-fields">
        <PasswordField
          label="Password baru"
          autoComplete="new-password"
          placeholder="Minimal 8 karakter"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setConfirmTouched(false);
          }}
        />
        <PasswordMeter password={password} />

        <PasswordField
          label="Ulangi password baru"
          autoComplete="new-password"
          placeholder="Ketik password yang sama"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          onBlur={() => setConfirmTouched(true)}
        />
      </div>

      {error && <p className="auth-message error" role="alert">{error}</p>}
      {mismatch && (
        <p className="auth-message error" role="alert">
          Konfirmasi password tidak sama.
        </p>
      )}

      <button
        className="primary-button auth-submit"
        disabled={busy || !requirementsMet || mismatch}
        type="submit"
      >
        {busy ? "Menyimpan..." : "Simpan password baru"}
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}