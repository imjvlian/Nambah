"use client";

import { InputHTMLAttributes, useState } from "react";

type PasswordFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "className"
> & {
  label: string;
  hint?: string;
};

/**
 * A password input with a reveal toggle.
 *
 * The toggle exists because typing a password twice into two boxes is an easy
 * way to introduce a typo, and on the reset form there is no confirmation
 * field to catch it.
 */
export default function PasswordField({
  label,
  hint,
  id,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? `pw-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      <span className="password-wrap">
        <input
          {...inputProps}
          id={inputId}
          type={visible ? "text" : "password"}
          className="password-input"
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Sembunyikan password" : "Tampilkan password"}
          aria-pressed={visible}
        >
          {visible ? "Sembunyi" : "Lihat"}
        </button>
      </span>
      {hint && <span className="auth-hint">{hint}</span>}
    </label>
  );
}