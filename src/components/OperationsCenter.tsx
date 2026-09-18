"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatIDR } from "@/lib/pricing";

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

function formatCheckedAt(value?: string | null) {
  if (!value) return "Menunggu health check";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status?: Payload["status"]) {
  if (status === "healthy") return "Healthy";
  if (status === "warning") return "Needs attention";
  if (status === "critical") return "Critical";
  return "Checking";
}

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

  const receiptIssues =
    (data?.counts.failedReceipts ?? 0) + (data?.counts.staleReceipts ?? 0);

  return (
    <main className="acc-page acc-page-standalone">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div>
            <small>Admin / Operations</small>
            <strong>Recovery Center</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin">← Control Center</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero acc-hero-standalone">
            <div>
              <span className="acc-eyebrow">Operational health</span>
              <h1>Operations Center.</h1>
              <p>
                Pantau stuck order, supplier pending, receipt, finance, dan saldo
                supplier dari satu recovery workspace.
              </p>
            </div>

            <article className={"acc-hero-status ops-status-" + (data?.status ?? "checking")}>
              <div className="acc-hero-status-head">
                <span>System status</span>
                <i className="acc-health-dot" aria-hidden="true" />
              </div>
              <strong>{statusLabel(data?.status)}</strong>
              <small>{formatCheckedAt(data?.checkedAt)}</small>

              <div className="ops-balance-summary">
                <div>
                  <span>Supplier balance</span>
                  <b>{data?.supplierBalance ? formatIDR(data.supplierBalance.balance) : "—"}</b>
                </div>
                <div>
                  <span>Reserved</span>
                  <b>{data?.supplierBalance ? formatIDR(data.supplierBalance.reservedBalance) : "—"}</b>
                </div>
              </div>
            </article>
          </section>

          {notice && (
            <div className="acc-global-notice acc-inline-notice" role="status">
              {notice}
            </div>
          )}

          <section className="acc-metrics ops-metrics" aria-label="Operational metrics">
            <article>
              <small>Stuck orders</small>
              <strong>{data?.counts.stuckOrders ?? 0}</strong>
              <span>Paid / processing lebih dari 5 menit</span>
            </article>
            <article>
              <small>Supplier pending</small>
              <strong>{data?.counts.pendingSupplier ?? 0}</strong>
              <span>Pending lebih dari 5 menit</span>
            </article>
            <article>
              <small>Receipt issues</small>
              <strong>{receiptIssues}</strong>
              <span>Failed atau stale delivery</span>
            </article>
            <article>
              <small>Finance errors</small>
              <strong>{data?.counts.financeErrors ?? 0}</strong>
              <span>Unresolved dalam 24 jam terakhir</span>
            </article>
          </section>

          <section className="acc-panel ops-actions-card">
            <div className="acc-section-head">
              <div>
                <span className="acc-eyebrow">Recovery actions</span>
                <h2>Jalankan recovery secara eksplisit.</h2>
                <p>
                  Gunakan reconciliation untuk memulihkan state yang tertunda.
                  Semua action tetap mengikuti guard idempotency Nambah.
                </p>
              </div>
            </div>
            <div className="acc-action-panel ops-action-buttons">
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
          </section>

          <section className="acc-table-card ops-incidents">
            <div className="ops-incidents-head">
              <span>Severity</span>
              <span>Incident</span>
              <span>Detail</span>
              <span>Count</span>
            </div>

            {(data?.incidents ?? []).map((item) => {
              const severityClass =
                item.severity === "critical"
                  ? "finance-error"
                  : item.severity === "warning"
                    ? "finance-warning"
                    : "finance-ok";

              return (
                <div className="ops-incidents-row" key={item.fingerprint}>
                  <strong className={"acc-status " + severityClass}>{item.severity}</strong>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                  <span>{item.count}</span>
                </div>
              );
            })}

            {data && data.incidents.length === 0 && (
              <div className="acc-empty">Tidak ada incident aktif.</div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
