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
 * Inline rather than pulled from an icon set: two glyphs do not justify a
 * dependency, and inlining keeps the stroke colour tied to the button's own
 * hover and focus states through currentColor.
 */
function EyeIcon() {
  return (
    <svg
      className="password-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      className="password-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17.6 17.6 0 0 1-2.7 3.7" />
      <path d="M6.6 6.7A17.6 17.6 0 0 0 2 12s3.6 6 10 6a9.8 9.8 0 0 0 3.8-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

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
          title={visible ? "Sembunyikan password" : "Tampilkan password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
      {hint && <span className="auth-hint">{hint}</span>}
    </label>
  );
}