"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConfirmTone = "default" | "danger";

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Baris detail opsional: label di kiri, nilai di kanan. */
  details?: Array<{ label: string; value: string }>;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type PendingConfirm = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * Dialog konfirmasi untuk aksi admin, menggantikan window.confirm bawaan
 * browser supaya tampilan konsisten dengan halaman.
 */
export default function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback<ConfirmContextValue>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function settle(result: boolean) {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }

  useEffect(() => {
    if (!pending) return;

    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      settle(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending]);

  const tone = pending?.tone ?? "default";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {pending && (
        <div
          className="admin-confirm-backdrop"
          role="presentation"
          onClick={() => settle(false)}
        >
          <section
            className={`admin-confirm admin-confirm-${tone}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="admin-confirm-title"
            aria-describedby={pending.description ? "admin-confirm-desc" : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="admin-confirm-head">
              <span className="admin-confirm-head-icon" aria-hidden="true">
                {tone === "danger" ? "!" : "?"}
              </span>
              <div className="admin-confirm-head-copy">
                <h3 id="admin-confirm-title">{pending.title}</h3>
                {pending.description && (
                  <p id="admin-confirm-desc">{pending.description}</p>
                )}
              </div>
            </header>

            {pending.details && pending.details.length > 0 && (
              <div className="admin-confirm-list">
                {pending.details.map((item) => (
                  <div className="admin-confirm-row" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            )}

            <footer className="admin-confirm-actions">
              <button
                ref={cancelRef}
                type="button"
                className="admin-confirm-cancel"
                onClick={() => settle(false)}
              >
                {pending.cancelLabel ?? "Batal"}
              </button>
              <button
                type="button"
                className={
                  tone === "danger"
                    ? "admin-confirm-accept admin-confirm-accept-danger"
                    : "admin-confirm-accept"
                }
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Ya, lanjutkan"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Pemanggil dialog konfirmasi. Returns false bila admin membatalkan. */
export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm harus dipakai di dalam ConfirmProvider.");
  }
  return context;
}