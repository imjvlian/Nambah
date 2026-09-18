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
    <main className="acc-page">
      <section className="acc-workspace" style={{ marginLeft: 0 }}>
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
          <section className="acc-hero">
            <div>
              <span className="acc-eyebrow">0.5.1 · Safe staging</span>
              <h1>Uji fulfillment tanpa ubah ENV.</h1>
              <p>
                Scenario hanya berlaku pada digiflazz-test. Test Lab tidak memiliki
                jalur untuk mengaktifkan fulfillment live.
              </p>
            </div>
          </section>

          {notice && <div className="acc-global-notice" role="status">{notice}</div>}

          <div className="acc-grid-two">
            <div className="acc-panel">
              <div className="acc-section-head">
                <div>
                  <span className="acc-eyebrow">Supplier scenario</span>
                  <h2>Digiflazz testing:true</h2>
                  <p>Pilih respons supplier untuk order staging berikutnya.</p>
                </div>
              </div>

              <label>
                Scenario
                <select value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="pending-success">Pending → Success</option>
                  <option value="pending-failed">Pending → Failed</option>
                </select>
              </label>

              <label>
                Scope
                <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  <option value="next-order">Next order only</option>
                  <option value="next-n">Next N orders</option>
                  <option value="until-changed">Until changed</option>
                </select>
              </label>

              {scope === "next-n" && (
                <label>
                  Jumlah order
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  />
                </label>
              )}

              <div className="acc-action-panel">
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
            </div>

            <div className="acc-panel">
              <div className="acc-section-head">
                <div>
                  <span className="acc-eyebrow">Current state</span>
                  <h2>{state?.enabled ? "ACTIVE" : "DISABLED"}</h2>
                  <p>{state?.safetyReason ?? "Memuat safety state..."}</p>
                </div>
              </div>
              <div className="acc-system-note">
                <div><small>Scenario</small><strong>{state?.scenario ?? "-"}</strong></div>
                <div><small>Scope</small><strong>{state?.scope ?? "-"}</strong></div>
                <div><small>Remaining</small><strong>{state?.remainingUses ?? "∞"}</strong></div>
              </div>
              <p>
                Setiap order yang memakai scenario admin menyimpan snapshot
                <code> provider_mode</code>, <code>test_scenario</code>, dan
                <code> test_scenario_source</code> untuk audit.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
