"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuthCaptcha } from "@/components/AuthCaptchaProvider";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import PasswordField from "@/components/PasswordField";
import PasswordMeter from "@/components/PasswordMeter";
import TurnstileWidget from "@/components/TurnstileWidget";
import { BRAND } from "@/lib/brand";
import { safeNext, signInHref } from "@/lib/next-path";
import { assessPassword } from "@/lib/password-strength";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 45;

type SignupFormProps = {
  nextPath?: string;
};

export default function SignupForm({ nextPath }: SignupFormProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { siteKey, token: turnstileToken, setToken: setTurnstileToken, widgetKey, reset: resetTurnstile } =
    useAuthCaptcha();
  const codeInputs = useRef<Array<HTMLInputElement | null>>([]);

  // Guards the auto-submit effect below: it must fire once per completed
  // code, not on every keystroke that happens to leave six digits in place.
  const autoSubmitted = useRef(false);

  const requirementsMet =
    password.length > 0 && assessPassword(password, email).requirementsMet;

  // Mismatch is only surfaced once both boxes are filled and the second has
  // been left. Flagging it while someone is still typing reads as the form
  // rejecting them for something they are in the middle of correcting.
  const mismatch =
    confirmTouched && confirmPassword.length > 0 && confirmPassword !== password;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function verify(codeValue: string) {
    setError("");
    setBusy(true);

    try {
      const response = await fetch("/api/auth/verify-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, code: codeValue }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Kode verifikasi belum dapat diperiksa.");
        setCode("");
        autoSubmitted.current = false;
        codeInputs.current[0]?.focus();
        return;
      }

      // The code is exchanged for a real session, so there is no second login
      // step and no password prompt here.
      window.location.href = safeNext(nextPath);
    } catch {
      setError(`Tidak dapat terhubung ke server akun ${BRAND.shortName}.`);
      setCode("");
      autoSubmitted.current = false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (code.length === CODE_LENGTH && !autoSubmitted.current && !busy) {
      autoSubmitted.current = true;
      void verify(code);
    }
  }, [code, busy]);

  function applyCode(next: string) {
    const digits = next.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length < CODE_LENGTH) {
      codeInputs.current[digits.length]?.focus();
    }
  }

  function onCodeChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");

    // A paste of the whole code lands in one box, so it is spread out here.
    if (digits.length > 1) {
      applyCode(digits);
      return;
    }

    if (digits.length === 0) {
      setCode(code.slice(0, index) + code.slice(index + 1));
      return;
    }

    applyCode(code.slice(0, index) + digits + code.slice(index + 1));
  }

  function onCodeKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !code[index] && index > 0) {
      event.preventDefault();
      codeInputs.current[index - 1]?.focus();
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      codeInputs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      codeInputs.current[index + 1]?.focus();
    }
  }

  async function resend() {
    setError("");
    setNotice("");
    setBusy(true);

    try {
      const response = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        setError(data.error ?? "Kode belum dapat dikirim.");
        resetTurnstile();
        return;
      }

      setNotice(data.message ?? "Kode yang baru sudah dikirim.");
      setCode("");
      autoSubmitted.current = false;
      setCooldown(RESEND_SECONDS);
      codeInputs.current[0]?.focus();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  function backToStepOne() {
    setStep(1);
    setCode("");
    setError("");
    setNotice("");
    setConfirmTouched(false);
    setCooldown(0);
    autoSubmitted.current = false;
  }

  async function submitStepOne(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          displayName,
          email,
          password,
          confirmPassword,
          turnstileToken,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        requiresEmailConfirmation?: boolean;
      };

      if (!response.ok) {
        setError(data.error ?? "Permintaan belum dapat diproses.");
        resetTurnstile();
        return;
      }

      if (data.requiresEmailConfirmation) {
        setStep(2);
        setNotice(
          data.message ?? "Kode 6 digit sudah dikirim ke emailmu.",
        );
        setCooldown(RESEND_SECONDS);
        resetTurnstile();
        return;
      }

      window.location.href = safeNext(nextPath);
    } catch {
      setError(`Tidak dapat terhubung ke server akun ${BRAND.shortName}.`);
    } finally {
      setBusy(false);
    }
  }

  function submitStepTwo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length === CODE_LENGTH && !busy) {
      autoSubmitted.current = true;
      void verify(code);
    }
  }

  return (
    <form className="auth-card" onSubmit={step === 1 ? submitStepOne : submitStepTwo}>
      {step === 1 ? (
        <>
          <div className="auth-card-head">
            <span className="eyebrow">Daftar</span>
            <h1>Buat akun {BRAND.shortName}.</h1>
            <p>Simpan riwayat transaksi dan buka status pesanan dari satu akun.</p>
          </div>

          <div className="auth-fields">
            <label className="auth-field">
              <span className="auth-label">Nama</span>
              <input
                autoComplete="name"
                maxLength={50}
                placeholder="Nama kamu"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>

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
              autoComplete="new-password"
              placeholder="Minimal 8 karakter"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setConfirmTouched(false);
              }}
            />
            <PasswordMeter password={password} email={email} />

            <PasswordField
              label="Ulangi password"
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
          {!siteKey && (
            <p className="auth-message error" role="alert">
              Captcha belum dikonfigurasi. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY.
            </p>
          )}

          {siteKey && (
            <TurnstileWidget
              key={widgetKey}
              siteKey={siteKey}
              action="signup"
              execution="render"
              onVerify={setTurnstileToken}
              onError={() => setTurnstileToken("")}
              onExpired={resetTurnstile}
            />
          )}

          <button
            className="primary-button auth-submit"
            disabled={busy || !requirementsMet || mismatch || Boolean(siteKey && !turnstileToken)}
            type="submit"
          >
            {busy ? "Memproses..." : "Buat akun"}
            <span aria-hidden="true">→</span>
          </button>

          <GoogleSignInButton next={nextPath} />

          <p className="auth-switch">
            Sudah punya akun? <a href={signInHref("/login", nextPath)}>Masuk</a>
          </p>
        </>
      ) : (
        <>
          <div className="auth-card-head">
            <span className="eyebrow">Langkah 2 dari 2</span>
            <h1>Masukkan kode verifikasi.</h1>
            <p>
              Kami mengirim kode 6 digit ke <b>{email}</b>. Masukkan kodenya untuk
              langsung masuk.
            </p>
          </div>

          <div className="code-inputs">
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <input
                key={index}
                ref={(node) => {
                  codeInputs.current[index] = node;
                }}
                className="code-box"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                pattern="[0-9]*"
                maxLength={CODE_LENGTH}
                aria-label={`Digit kode ke-${index + 1}`}
                value={code[index] ?? ""}
                disabled={busy}
                onChange={(event) => onCodeChange(index, event.target.value)}
                onKeyDown={(event) => onCodeKeyDown(index, event)}
                onPaste={(event) => {
                  event.preventDefault();
                  applyCode(event.clipboardData.getData("text"));
                }}
              />
            ))}
          </div>

          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message success" role="status">{notice}</p>}

          <p className="code-meta">
            Tidak menerima email?{" "}
            {cooldown > 0 ? (
              <span>Kirim ulang dalam {cooldown} detik</span>
            ) : (
              <button type="button" className="text-link" onClick={resend} disabled={busy}>
                Kirim ulang kode
              </button>
            )}
          </p>

          <button type="button" className="text-link auth-back" onClick={backToStepOne}>
            Ganti email
          </button>
        </>
      )}
    </form>
  );
}