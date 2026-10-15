import { useEffect, useState } from "react";
import { safeNext } from "@/lib/next-path";
import TurnstileWidget from "@/components/TurnstileWidget";

type GoogleSignInButtonProps = {
  next?: string;
};

/**
 * Google's four-colour mark, used as the brand requires.
 */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * Sign-in with Google as a plain link.
 *
 * Deliberately not a button that calls fetch: the flow ends in a redirect back
 * from Google, so there is nothing to await. As a link it keeps working with
 * JavaScript disabled and behaves correctly for keyboard and screen reader
 * users, all of which a div with a click handler would not.
 */
export default function GoogleSignInButton({ next }: GoogleSignInButtonProps) {
  const resolved = safeNext(next);
  const [token, setToken] = useState("");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
  const params = new URLSearchParams();
  if (resolved !== "/account") params.set("next", resolved);
  if (token) params.set("turnstileToken", token);
  const href = `/api/auth/google${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <div className="auth-alt">
      <span className="auth-alt-rule" aria-hidden="true" />
      <span className="auth-alt-label">atau</span>
      <span className="auth-alt-rule" aria-hidden="true" />
      <a className="google-button" href={href}>
        <GoogleMark />
        <span>Lanjutkan dengan Google</span>
      </a>
      {siteKey && (
        <TurnstileWidget
          siteKey={siteKey}
          action="google-sign-in"
          execution="render"
          onVerify={setToken}
        />
      )}
    </div>
  );
}