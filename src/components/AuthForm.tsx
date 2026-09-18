"use client";

import { FormEvent, useState } from "react";

type AuthMode = "login" | "register";

type AuthFormProps = {
  mode: AuthMode;
  nextPath?: string;
  confirmed?: boolean;
};

function safeNext(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/account";
  return value;
}

export default function AuthForm({
  mode,
  nextPath,
  confirmed = false,
}: AuthFormProps) {
  const isRegister = mode === "register";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(
    confirmed ? "Email sudah dikonfirmasi. Silakan login." : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    try {
      const response = await fetch(
        isRegister ? "/api/auth/signup" : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...(isRegister ? { displayName } : {}),
            email,
            password,
          }),
        },
      );

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        requiresEmailConfirmation?: boolean;
      };

      if (!response.ok) {
        setError(data.error ?? "Permintaan belum dapat diproses.");
        return;
      }

      if (isRegister && data.requiresEmailConfirmation) {
        setNotice(
          data.message ??
            "Akun dibuat. Cek email untuk konfirmasi, lalu login.",
        );
        return;
      }

      window.location.href = safeNext(nextPath);
    } catch {
      setError("Tidak dapat terhubung ke server akun Nambah.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-card-head">
        <span className="eyebrow">{isRegister ? "Daftar" : "Masuk"}</span>
        <h1>{isRegister ? "Buat akun Nambah." : "Selamat datang lagi."}</h1>
        <p>
          {isRegister
            ? "Simpan riwayat transaksi dan buka status pesanan dari satu akun."
            : "Masuk untuk melihat transaksi dan status pesananmu."}
        </p>
      </div>

      <div className="auth-fields">
        {isRegister && (
          <label>
            <span>Nama</span>
            <input
              autoComplete="name"
              maxLength={50}
              placeholder="Nama kamu"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}

        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            inputMode="email"
            type="email"
            placeholder="nama@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label>
          <span>Password</span>
          <input
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={isRegister ? 8 : undefined}
            type="password"
            placeholder={isRegister ? "Minimal 8 karakter" : "Password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      </div>

      {error && <p className="auth-message error" role="alert">{error}</p>}
      {notice && <p className="auth-message success" role="status">{notice}</p>}

      <button className="primary-button auth-submit" disabled={busy} type="submit">
        {busy
          ? "Memproses..."
          : isRegister
            ? "Buat akun"
            : "Masuk"}
        <span aria-hidden="true">→</span>
      </button>

      <p className="auth-switch">
        {isRegister ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
        <a
          href={
            isRegister
              ? `/login${nextPath ? `?next=${encodeURIComponent(safeNext(nextPath))}` : ""}`
              : `/register${nextPath ? `?next=${encodeURIComponent(safeNext(nextPath))}` : ""}`
          }
        >
          {isRegister ? "Masuk" : "Daftar"}
        </a>
      </p>
    </form>
  );
}
