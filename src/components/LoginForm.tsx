"use client";

import { FormEvent, useState } from "react";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import PasswordField from "@/components/PasswordField";
import { useAuthCaptcha } from "@/components/AuthCaptchaProvider";import { BRAND } from "@/lib/brand";
import { safeNext, signInHref } from "@/lib/next-path";

type LoginFormProps = {
  nextPath?: string;
  /**
   * Only meaningful under the old confirmation-link flow. Kept so an old
   * bookmarked link still explains itself instead of rendering a blank notice.
   */
  confirmed?: boolean;
  /** Set when the Google flow bounced back without completing. */
  oauthError?: string;
};

const OAUTH_ERRORS: Record<string, string> = {
  google:
    "Login dengan Google belum selesai. Coba lagi, atau pakai email dan password.",
  captcha:
    "Captcha tidak valid. Coba lagi.",
};

export default function LoginForm({
  nextPath,
  confirmed = false,
  oauthError,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(
    confirmed ? "Email sudah dikonfirmasi. Silakan login." : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { siteKey, token: turnstileToken, reset: resetTurnstile } =
    useAuthCaptcha();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, turnstileToken }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Permintaan belum dapat diproses.");
        resetTurnstile();
        return;
      }

      resetTurnstile();
      window.location.href = safeNext(nextPath);
    } catch {
      setError(`Tidak dapat terhubung ke server akun ${BRAND.shortName}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-card-head">
        <span className="eyebrow">Masuk</span>
        <h1>Selamat datang lagi.</h1>
        <p>Masuk untuk melihat transaksi dan status pesananmu.</p>
      </div>

      <div className="auth-fields">
        <label className="auth-field">
          <span className="auth-label">Email</span>
          <input
            autoComplete="email"
            inputMode="email"
            type="email"
            placeholder="nama@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <PasswordField
          label="Password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <p className="auth-forgot">
          <a href="/lupa-password">Lupa password?</a>
        </p>
      </div>

      {error && <p className="auth-message error" role="alert">{error}</p>}
      {notice && <p className="auth-message success" role="status">{notice}</p>}
      {oauthError && (
        <p className="auth-message error" role="alert">
          {OAUTH_ERRORS[oauthError] ?? OAUTH_ERRORS.google}
        </p>
      )}

      <button className="primary-button auth-submit" disabled={busy || Boolean(siteKey && !turnstileToken)} type="submit">
        {busy ? "Memproses..." : "Masuk"}
        <span aria-hidden="true">→</span>
      </button>

      <GoogleSignInButton next={nextPath} />

      <p className="auth-switch">
        Belum punya akun?{" "}
        <a href={signInHref("/register", nextPath)}>Daftar</a>
      </p>
    </form>
  );
}