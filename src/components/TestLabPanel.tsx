"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Scenario = "success" | "failed" | "pending-success" | "pending-failed";
type Scope = "next-order" | "next-n" | "until-changed";

type State = {
  enabled: boolean;
  scenario: Scenario;
  scope: Scope;
  remainingUses: number | null;
  updatedAt: string | null;
  safeToEnable: boolean;
  safetyReason: string;
};

function scenarioLabel(value?: Scenario) {
  if (value === "success") return "Success";
  if (value === "failed") return "Failed";
  if (value === "pending-success") return "Pending → Success";
  if (value === "pending-failed") return "Pending → Failed";
  return "—";
}

function scopeLabel(value?: Scope) {
  if (value === "next-order") return "Next order";
  if (value === "next-n") return "Next N orders";
  if (value === "until-changed") return "Until changed";
  return "—";
}

export default function TestLabPanel() {
  const [state, setState] = useState<State | null>(null);
  const [scenario, setScenario] = useState<Scenario>("success");
  const [scope, setScope] = useState<Scope>("next-order");
  const [count, setCount] = useState("5");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/test-lab", { cache: "no-store" });
    if (response.status === 401) {
      window.location.replace("/login?next=%2Fadmin%2Ftest-lab");
      return;
    }
    const data = (await response.json()) as { testLab?: State; error?: string };
    if (!response.ok || !data.testLab) {
      throw new Error(data.error ?? "Test Lab gagal dimuat.");
    }
    setState(data.testLab);
    setScenario(data.testLab.scenario);
    setScope(data.testLab.scope);
    if (data.testLab.remainingUses && data.testLab.remainingUses > 1) {
      setCount(String(data.testLab.remainingUses));
    }
  }

  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Test Lab gagal dimuat."),
    );
  }, []);

  async function save(enabled: boolean) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/test-lab", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          scenario,
          scope,
          remainingUses: scope === "next-n" ? Number(count) : undefined,
        }),
      });
      const data = (await response.json()) as { testLab?: State; error?: string };
      if (!response.ok || !data.testLab) {
        throw new Error(data.error ?? "Test Lab gagal diperbarui.");
      }
      setState(data.testLab);
      setNotice(enabled ? "Scenario staging diaktifkan." : "Test Lab dinonaktifkan.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Test Lab gagal diperbarui.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="acc-page acc-page-standalone">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div>
            <small>Admin / System</small>
            <strong>Staging Test Lab</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin">← Control Center</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero acc-hero-standalone">
            <div>
              <span className="acc-eyebrow">Safe staging</span>
              <h1>Uji fulfillment tanpa ubah ENV.</h1>
              <p>
                Atur respons Digiflazz testing:true untuk order staging berikutnya.
                Test Lab tidak mempunyai jalur untuk mengaktifkan fulfillment live.
              </p>
            </div>

            <article className={"acc-hero-status testlab-state-" + (state?.enabled ? "active" : "disabled")}>
              <div className="acc-hero-status-head">
                <span>Current state</span>
                <i className="acc-health-dot" aria-hidden="true" />
              </div>
              <strong>{state?.enabled ? "Active" : "Disabled"}</strong>
              <small>{state?.safetyReason ?? "Memuat safety state..."}</small>
              <div className="testlab-hero-meta">
                <span>{scenarioLabel(state?.scenario)}</span>
                <span>{scopeLabel(state?.scope)}</span>
              </div>
            </article>
          </section>

          {notice && (
            <div className="acc-global-notice acc-inline-notice" role="status">
              {notice}
            </div>
          )}

          <div className="acc-grid-two testlab-grid">
            <section className="acc-panel">
              <div className="acc-section-head">
                <div>
                  <span className="acc-eyebrow">Supplier scenario</span>
                  <h2>Digiflazz testing:true</h2>
                  <p>Pilih perilaku supplier untuk checkout staging berikutnya.</p>
                </div>
              </div>

              <div className="testlab-form-grid">
                <label className="acc-field">
                  <span>Scenario</span>
                  <select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="pending-success">Pending → Success</option>
                    <option value="pending-failed">Pending → Failed</option>
                  </select>
                  <small>Menentukan respons awal dan terminal supplier.</small>
                </label>

                <label className="acc-field">
                  <span>Scope</span>
                  <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
                    <option value="next-order">Next order only</option>
                    <option value="next-n">Next N orders</option>
                    <option value="until-changed">Until changed</option>
                  </select>
                  <small>Batasi berapa order yang menggunakan scenario ini.</small>
                </label>

                {scope === "next-n" && (
                  <label className="acc-field">
                    <span>Jumlah order</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={count}
                      onChange={(event) => setCount(event.target.value)}
                    />
                    <small>Minimal 1, maksimal 100 order.</small>
                  </label>
                )}
              </div>

              <div className="acc-action-panel testlab-actions">
                <button
                  type="button"
                  disabled={busy || !state?.safeToEnable}
                  onClick={() => void save(true)}
                >
                  {busy ? "Saving..." : "Activate scenario"}
                </button>
                <button
                  type="button"
                  className="admin-secondary-button"
                  disabled={busy}
                  onClick={() => void save(false)}
                >
                  Disable
                </button>
              </div>

              {!state?.safeToEnable && state && (
                <div className="testlab-safety-warning">
                  <strong>Activation locked</strong>
                  <span>{state.safetyReason}</span>
                </div>
              )}
            </section>

            <section className="acc-panel testlab-state-panel">
              <div className="acc-section-head">
                <div>
                  <span className="acc-eyebrow">Frozen test state</span>
                  <h2>Order menyimpan scenario sendiri.</h2>
                  <p>
                    Perubahan setting setelah checkout tidak mengubah scenario yang
                    sudah dibekukan pada order.
                  </p>
                </div>
              </div>

              <div className="acc-system-note testlab-system-note">
                <div>
                  <small>Scenario</small>
                  <strong>{scenarioLabel(state?.scenario)}</strong>
                </div>
                <div>
                  <small>Scope</small>
                  <strong>{scopeLabel(state?.scope)}</strong>
                </div>
                <div>
                  <small>Remaining</small>
                  <strong>{state?.remainingUses ?? "∞"}</strong>
                </div>
                <div>
                  <small>Safe to enable</small>
                  <strong>{state?.safeToEnable ? "YES" : "NO"}</strong>
                </div>
              </div>

              <div className="testlab-audit-note">
                <span>Audit snapshot</span>
                <p>
                  Setiap order test menyimpan <code>provider_mode</code>,{" "}
                  <code>test_scenario</code>, dan <code>test_scenario_source</code>.
                </p>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
