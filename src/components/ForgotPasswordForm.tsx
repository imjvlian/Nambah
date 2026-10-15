"use client";

import { FormEvent, useState } from "react";
import { useAuthCaptcha } from "@/components/AuthCaptchaProvider";

/**
 * Requests a password reset link.
 *
 * The success message is deliberately fixed and does not depend on whether
 * the address has an account. The server enforces that too, but repeating it
 * here means the wording on screen never gives anything away either.
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState("");
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
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });

      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        setError(data.error ?? "Permintaan belum dapat diproses.");
        return;
      }

      setNotice(
        data.message ??
          "Kalau email itu terdaftar, kami sudah mengirim tautan untuk mengatur ulang password.",
      );
      setSent(true);
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-card-head">
        <span className="eyebrow">Lupa password</span>
        <h1>Atur ulang password.</h1>
        <p>
          Masukkan email yang kamu pakai mendaftar. Kami akan mengirim tautan
          untuk membuat password baru.
        </p>
      </div>

      <div className="auth-fields">
        <label className="auth-field">
          <span className="auth-label">Email</span>
          <input
            autoComplete="email"
            inputMode="email"
            type="email"
            required
            placeholder="nama@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={sent}
          />
        </label>
      </div>

      {error && <p className="auth-message error" role="alert">{error}</p>}
      {notice && <p className="auth-message success" role="status">{notice}</p>}

      <button className="primary-button auth-submit" disabled={busy || sent || Boolean(!turnstileToken)} type="submit">
        {busy ? "Mengirim..." : "Kirim tautan"}
        <span aria-hidden="true">→</span>
      </button>

      <p className="auth-switch">
        Ingat passwordnya?{" "}
        <a href="/login">Kembali ke halaman masuk</a>
      </p>
    </form>
  );
}