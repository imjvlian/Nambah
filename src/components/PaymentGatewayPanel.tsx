"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/AdminConfirmDialog";

type ProviderStatus = {
  id: "midtrans" | "doku";
  name: string;
  configured: boolean;
  environment: "sandbox" | "production" | null;
  note: string;
};

type SettingsPayload = {
  activeProvider?: "midtrans" | "doku";
  providers?: ProviderStatus[];
  settingsReady?: boolean;
  error?: string;
};

export default function PaymentGatewayPanel() {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoadError("");
    try {
      const response = await fetch("/api/admin/payment-settings", {
        cache: "no-store",
      });
      const body = (await response.json()) as SettingsPayload;
      if (!response.ok) {
        throw new Error(body.error ?? "Pengaturan gateway gagal dimuat.");
      }
      setPayload(body);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Pengaturan gateway gagal dimuat.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function switchProvider(provider: "midtrans" | "doku") {
    if (!payload || provider === payload.activeProvider || busy) return;
    const target = payload.providers?.find((item) => item.id === provider);
    const confirmed = await confirm({
      title: `Alihkan gateway ke ${target?.name ?? provider}?`,
      description:
        "Hanya memengaruhi order baru — order yang sedang berjalan tetap diproses oleh gateway pembuatnya.",
      details: [{ label: "Gateway aktif", value: target?.name ?? provider }],
      confirmLabel: "Alihkan gateway",
    });
    if (!confirmed) return;

    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/payment-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = (await response.json()) as SettingsPayload;
      if (!response.ok) {
        throw new Error(body.error ?? "Gateway gagal dialihkan.");
      }
      setPayload((current) =>
        current
          ? { ...current, activeProvider: body.activeProvider, providers: body.providers }
          : body,
      );
      setNotice(
        `Gateway aktif kini ${target?.name ?? provider}. Order baru akan memakai gateway ini.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Gateway gagal dialihkan.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="acc-panel">
        <div className="acc-empty">{loadError}</div>
      </section>
    );
  }
  if (!payload) return null;

  return (
    <section className="acc-panel">
      <div className="acc-section-head">
        <div>
          <span className="acc-eyebrow">Payment gateway</span>
          <h2>Gateway aktif untuk order baru.</h2>
        </div>
        <span className="acc-gateway-active">
          Aktif: <b>{payload.activeProvider === "doku" ? "DOKU" : "Midtrans"}</b>
        </span>
      </div>

      {notice && (
        <div className="acc-global-notice acc-inline-notice" role="status">
          {notice}
        </div>
      )}

      <div className="acc-gateway-grid">
        {(payload.providers ?? []).map((provider) => {
          const isActive = payload.activeProvider === provider.id;
          return (
            <article
              key={provider.id}
              className={`acc-gateway-card ${isActive ? "active" : ""} ${provider.configured ? "" : "unconfigured"}`}
            >
              <div className="acc-gateway-card-head">
                <strong>{provider.name}</strong>
                {isActive && <span className="acc-chip-active">Aktif</span>}
              </div>
              <small>
                {provider.configured
                  ? `Terkonfigurasi · ${provider.environment}`
                  : "Belum terkonfigurasi"}
              </small>
              <p>{provider.note}</p>
              <button
                type="button"
                disabled={busy || isActive || !provider.configured}
                onClick={() => void switchProvider(provider.id)}
              >
                {busy
                  ? "Mengalihkan..."
                  : isActive
                    ? "Sedang aktif"
                    : provider.configured
                      ? `Alihkan ke ${provider.name}`
                      : "Isi env dulu"}
              </button>
            </article>
          );
        })}
      </div>

      <small className="acc-gateway-hint">
        Switch hanya memengaruhi order baru. Order yang sedang menunggu bayar
        tetap diproses oleh gateway pembuatnya (webhook &amp; status-check
        mengikuti provider masing-masing order).
      </small>
    </section>
  );
}
