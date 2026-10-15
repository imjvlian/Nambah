"use client";

import { useEffect, useRef } from "react";

type TurnstileRenderOptions = {
  sitekey: string;
  action?: string;
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "compact" | "flexible";
  execution?: "render" | "execute";
};

type TurnstileController = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  execute: (container: HTMLElement | string) => void;
  reset: (container: HTMLElement | string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileController;
  }
}

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileWidgetRef {
  reset: () => void;
  execute: () => void;
}

type TurnstileWidgetProps = {
  siteKey: string;
  action?: string;
  onVerify: (token: string) => void;
  onError?: () => void;
  onExpired?: () => void;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "compact" | "flexible";
  execution?: "render" | "execute";
};

async function loadTurnstileScript() {
  if (typeof window === "undefined") return null;
  if (window.turnstile) return window.turnstile;

  return new Promise<TurnstileController | null>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile-script="true"]',
    );
    if (existing) {
      const check = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("Turnstile failed to load."));
      };
      existing.addEventListener("load", check, { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load.")), {
        once: true,
      });
      return;
    }

    let done = false;
    const script = document.createElement("script");
    script.id = "turnstile-script";
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "true";
    script.onload = () => {
      if (!done) {
        done = true;
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("Turnstile failed to load."));
      }
    };
    script.onerror = () => {
      if (!done) {
        done = true;
        reject(new Error("Turnstile failed to load."));
      }
    };
    document.head.appendChild(script);
  });
}

/**
 * Invisible Cloudflare Turnstile widget.
 *
 * The widget stays mounted, while the assessment result is reported through
 * `onVerify`. Calling code can choose when to reset/execute it.
 */
export default function TurnstileWidget({
  siteKey,
  action,
  onVerify,
  onError,
  onExpired,
  theme = "auto",
  size = "normal",
  execution = "render",
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;

    void (async () => {
      try {
        const turnstile = await loadTurnstileScript();
        if (!turnstile || cancelled || !containerRef.current) return;

        widgetIdRef.current = turnstile.render(container, {
          sitekey: siteKey,
          action,
          callback: (token) => onVerify(token),
          "error-callback": () => onError?.(),
          "expired-callback": () => onExpired?.(),
          theme,
          size,
          execution,
        });
      } catch {
        onError?.();
      }
    })();

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          // Safe to ignore: the container is already being removed.
        }
      }
    };
  }, [siteKey, action, onVerify, onError, onExpired, theme, size, execution]);

  if (!siteKey) return null;

  return <div ref={containerRef} className="auth-turnstile" aria-hidden="true" />;
}
