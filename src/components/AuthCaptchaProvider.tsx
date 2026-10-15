"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

type AuthCaptchaContextValue = {
  siteKey: string;
  token: string;
  setToken: (token: string) => void;
  widgetKey: number;
  reset: () => void;
};

const AuthCaptchaContext = createContext<AuthCaptchaContextValue | null>(null);

export function useAuthCaptcha() {
  const value = useContext(AuthCaptchaContext);
  if (!value) {
    throw new Error("useAuthCaptcha must be used inside AuthCaptchaProvider");
  }
  return value;
}

export default function AuthCaptchaProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
  const [token, setToken] = useState("");
  const [widgetKey, setWidgetKey] = useState(0);

  const reset = useCallback(() => {
    if (!siteKey) return;
    setToken("");
    setWidgetKey((key) => key + 1);
  }, [siteKey]);

  return (
    <AuthCaptchaContext.Provider
      value={{ siteKey, token, setToken, widgetKey, reset }}
    >
      {children}
    </AuthCaptchaContext.Provider>
  );
}