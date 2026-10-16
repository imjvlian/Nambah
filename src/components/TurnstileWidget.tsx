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

let turnstileScriptPromise: Promise<TurnstileController | null> | null = null;

function loadTurnstileScript(): Promise<TurnstileController | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise<TurnstileController | null>(
      (resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
          'script[data-turnstile="true"]',
        );

        if (existing) {
          const handleLoad = () => {
            if (window.turnstile) resolve(window.turnstile);
            else reject(new Error("Turnstile failed to load."));
          };
          const handleError = () =>
            reject(new Error("Turnstile failed to load."));

          existing.addEventListener("load", handleLoad, { once: true });
          existing.addEventListener("error", handleError, { once: true });
          return;
        }

        const script = document.createElement("script");
        script.id = "turnstile-script";
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = "true";

        script.onload = () => {
          if (window.turnstile) resolve(window.turnstile);
          else reject(new Error("Turnstile failed to load."));
        };
        script.onerror = () => reject(new Error("Turnstile failed to load."));

        document.head.appendChild(script);
      },
    );
  }

  return turnstileScriptPromise;
}

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

/**
 * Persistent Cloudflare Turnstile widget.
 *
 * The widget is mounted once and does not remount when the parent re-renders.
 * Callbacks are kept in refs so typing in the surrounding form never resets
 * the challenge.
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
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onErrorRef.current = onError;
    onExpiredRef.current = onExpired;
  }, [onVerify, onError, onExpired]);

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
          callback: (token) => onVerifyRef.current(token),
          "error-callback": () => onErrorRef.current?.(),
          "expired-callback": () => onExpiredRef.current?.(),
          theme,
          size,
          execution,
        });
      } catch {
        onErrorRef.current?.();
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
  }, [siteKey, action, theme, size, execution]);

  if (!siteKey) return null;

  return (
    <div ref={containerRef} className="auth-turnstile" aria-hidden="true" />
  );
}
