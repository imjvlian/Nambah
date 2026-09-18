"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Payload = {
  checkedAt: string;
  status: "healthy" | "warning" | "critical";
  counts: {
    stuckOrders: number;
    pendingSupplier: number;
    failedReceipts: number;
    staleReceipts: number;
    financeErrors: number;
  };
  supplierBalance: null | {
    status: string;
    balance: number;
    reservedBalance: number;
    checkedAt: string;
  };
  incidents: Array<{
    fingerprint: string;
    severity: "info" | "warning" | "critical";
    title: string;
    detail: string;
    count: number;
  }>;
};

export default function OperationsCenter() {
  const [data, setData] = useState<Payload | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const response = await fetch("/api/admin/operations/health", { cache: "no-store" });
    if (response.status === 401) {
      window.location.replace("/login?next=%2Fadmin%2Foperations");
      return;
    }
    const body = (await response.json()) as Payload & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Operations health gagal dimuat.");
    setData(body);
  }

  async function reconcile() {
    setBusy("reconcile");
    setNotice("");
    try {
      const response = await fetch("/api/admin/reconciliation", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Reconciliation gagal.");
      await load();
      setNotice("Reconciliation selesai. Health state sudah diperbarui.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Reconciliation gagal.");
    } finally {
      setBusy("");
    }
  }

  async function finance() {
    setBusy("finance");
    setNotice("");
    try {
      const response = await fetch("/api/admin/finance", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Finance reconciliation gagal.");
      await load();
      setNotice("Financial reconciliation selesai.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Finance reconciliation gagal.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Operations health gagal dimuat."),
    );
  }, []);

  return (
    <main className="acc-page">
      <section className="acc-workspace" style={{ marginLeft: 0 }}>
        <header className="acc-topbar">
          <div><small>Admin / Operations</small><strong>Recovery Center</strong></div>
          <div className="acc-topbar-actions"><Link href="/admin">← Control Center</Link></div>
        </header>
        <div className="acc-content">
          <section className="acc-hero">
            <div>
              <span className="acc-eyebrow">Operational health</span>
              <h1>{data?.status?.toUpperCase() ?? "CHECKING"}</h1>
              <p>Stuck orders, supplier pending, receipt, finance, dan supplier balance dalam satu view.</p>
            </div>
          </section>
          {notice && <div className="acc-global-notice" role="status">{notice}</div>}
          <div className="acc-metrics">
            <article><small>Stuck orders</small><strong>{data?.counts.stuckOrders ?? 0}</strong><span>paid/processing &gt; 5m</span></article>
            <article><small>Supplier pending</small><strong>{data?.counts.pendingSupplier ?? 0}</strong><span>&gt; 5m</span></article>
            <article><small>Receipt issues</small><strong>{(data?.counts.failedReceipts ?? 0) + (data?.counts.staleReceipts ?? 0)}</strong><span>failed / stale</span></article>
            <article><small>Finance errors</small><strong>{data?.counts.financeErrors ?? 0}</strong><span>last 24h</span></article>
          </div>
          <div className="acc-action-panel">
            <button type="button" disabled={Boolean(busy)} onClick={() => void reconcile()}>
              {busy === "reconcile" ? "Reconciling..." : "Run order reconciliation"}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void finance()}>
              {busy === "finance" ? "Checking..." : "Run finance reconciliation"}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void load()}>
              Refresh health
            </button>
          </div>
          <div className="acc-table-card">
            <div className="acc-receipts-head"><span>Severity</span><span>Incident</span><span>Detail</span><span>Count</span></div>
            {(data?.incidents ?? []).map((item) => (
              <div className="acc-receipts-row" key={item.fingerprint}>
                <strong className={"acc-status finance-" + (item.severity === "critical" ? "error" : "warning")}>{item.severity}</strong>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <span>{item.count}</span>
              </div>
            ))}
            {data && data.incidents.length === 0 && <div className="acc-empty">Tidak ada incident aktif.</div>}
          </div>
        </div>
      </section>
    </main>
  );
}
