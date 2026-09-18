"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";

type AffiliatePayload = {
  stats: {
    affiliates: number;
    active: number;
    pending: number;
    available: number;
    reserved: number;
    withdrawn: number;
    cancelled: number;
  };
  affiliates: Array<{
    code: string;
    displayName: string;
    userId: string | null;
    commissionRate: number;
    status: string;
    createdAt: string;
  }>;
  error?: string;
};

type WithdrawalPayload = {
  withdrawals: Array<{
    id: number;
    affiliateCode: string;
    amount: number;
    method: string;
    accountName: string;
    accountNumber: string;
    status: string;
    requestedAt: string;
    processedAt: string | null;
    paidAt: string | null;
    rejectionReason: string | null;
    externalReference: string | null;
    processedByUserId: string | null;
  }>;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function AffiliateAdminPanel() {
  const [affiliates, setAffiliates] = useState<AffiliatePayload | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalPayload["withdrawals"]>([]);
  const [role, setRole] = useState("");
  const [linkDraft, setLinkDraft] = useState({ code: "", userId: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const canPayout = role === "superadmin";

  async function load() {
    const [affiliateResponse, withdrawalResponse, sessionResponse] =
      await Promise.all([
        fetch("/api/admin/affiliates", { cache: "no-store" }),
        fetch("/api/admin/affiliates/withdrawals", { cache: "no-store" }),
        fetch("/api/admin/session", { cache: "no-store" }),
      ]);

    if (
      affiliateResponse.status === 401 ||
      withdrawalResponse.status === 401 ||
      sessionResponse.status === 401
    ) {
      window.location.replace("/login?next=%2Fadmin%2Faffiliates");
      return;
    }

    const affiliateData = (await affiliateResponse.json()) as AffiliatePayload;
    const withdrawalData =
      (await withdrawalResponse.json()) as WithdrawalPayload;
    const sessionData = (await sessionResponse.json()) as {
      role?: string;
      error?: string;
    };

    if (!affiliateResponse.ok) {
      throw new Error(affiliateData.error ?? "Affiliate gagal dimuat.");
    }
    if (!withdrawalResponse.ok) {
      throw new Error(withdrawalData.error ?? "Withdrawal gagal dimuat.");
    }

    setAffiliates(affiliateData);
    setWithdrawals(withdrawalData.withdrawals ?? []);
    setRole(sessionData.role ?? "");
    if (!linkDraft.code && affiliateData.affiliates[0]) {
      setLinkDraft((current) => ({
        ...current,
        code: affiliateData.affiliates[0]!.code,
      }));
    }
  }

  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Affiliate gagal dimuat."),
    );
  }, []);

  const activeCount = useMemo(
    () =>
      withdrawals.filter(
        (item) => item.status === "pending" || item.status === "approved",
      ).length,
    [withdrawals],
  );

  async function linkUser() {
    setBusy("link");
    setNotice("");
    try {
      const response = await fetch("/api/admin/affiliates/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(linkDraft),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Affiliate gagal dihubungkan.");
      }
      await load();
      setNotice("Affiliate user link diperbarui.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Affiliate gagal dihubungkan.",
      );
    } finally {
      setBusy("");
    }
  }

  async function transition(
    withdrawalId: number,
    action: "approve" | "reject" | "paid",
  ) {
    let reason = "";
    let externalReference = "";

    if (action === "reject") {
      reason = window.prompt("Alasan penolakan:")?.trim() ?? "";
      if (!reason) return;
    }

    if (action === "paid") {
      externalReference =
        window.prompt("Reference pembayaran / transfer:")?.trim() ?? "";
      if (!externalReference) return;
    }

    setBusy(action + ":" + withdrawalId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/affiliates/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          withdrawalId,
          action,
          reason,
          externalReference,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Withdrawal gagal diperbarui.");
      }
      await load();
      setNotice("Withdrawal berhasil diperbarui: " + action + ".");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Withdrawal gagal diperbarui.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="acc-page">
      <section className="acc-workspace" style={{ marginLeft: 0 }}>
        <header className="acc-topbar">
          <div>
            <small>Admin / Affiliate</small>
            <strong>Withdrawal Center</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin">← Control Center</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero">
            <div>
              <span className="acc-eyebrow">Affiliate payout</span>
              <h1>Review dulu, bayar di luar sistem.</h1>
              <p>
                Nambah mengunci commission allocation secara atomic. Transfer
                dana tetap dilakukan operator, lalu superadmin menandai request paid
                dengan reference pembayaran.
              </p>
            </div>
          </section>

          {notice && <div className="acc-global-notice" role="status">{notice}</div>}

          <div className="acc-metrics">
            <article>
              <small>Available</small>
              <strong>{formatIDR(affiliates?.stats.available ?? 0)}</strong>
              <span>Belum di-reserve withdrawal</span>
            </article>
            <article>
              <small>Reserved</small>
              <strong>{formatIDR(affiliates?.stats.reserved ?? 0)}</strong>
              <span>{activeCount} request aktif</span>
            </article>
            <article>
              <small>Paid</small>
              <strong>{formatIDR(affiliates?.stats.withdrawn ?? 0)}</strong>
              <span>Withdrawal selesai</span>
            </article>
            <article>
              <small>Role</small>
              <strong>{role || "-"}</strong>
              <span>{canPayout ? "Payout action enabled" : "Read-only payout"}</span>
            </article>
          </div>

          <div className="acc-panel">
            <div className="acc-section-head">
              <div>
                <span className="acc-eyebrow">Ownership</span>
                <h2>Hubungkan affiliate ke akun Nambah.</h2>
                <p>
                  User ID berasal dari Admin → Users. Satu akun hanya dapat
                  memiliki satu affiliate link.
                </p>
              </div>
            </div>
            <div className="acc-action-panel">
              <select
                value={linkDraft.code}
                onChange={(event) =>
                  setLinkDraft((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
              >
                {(affiliates?.affiliates ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} · {item.displayName}
                  </option>
                ))}
              </select>
              <input
                placeholder="User UUID (kosong = unlink)"
                value={linkDraft.userId}
                onChange={(event) =>
                  setLinkDraft((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
              />
              <button
                type="button"
                disabled={busy === "link" || !canPayout}
                onClick={() => void linkUser()}
              >
                {busy === "link" ? "Saving..." : "Save user link"}
              </button>
            </div>

            <div className="acc-table-card">
              <div className="acc-receipts-head">
                <span>Affiliate</span>
                <span>User</span>
                <span>Rate</span>
                <span>Status</span>
              </div>
              {(affiliates?.affiliates ?? []).map((item) => (
                <div className="acc-receipts-row" key={item.code}>
                  <div>
                    <strong>{item.code}</strong>
                    <span>{item.displayName}</span>
                  </div>
                  <span>{item.userId ?? "Belum linked"}</span>
                  <strong>{Math.round(item.commissionRate * 100)}%</strong>
                  <span className={"acc-status " + item.status}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="acc-table-card">
            <div className="acc-receipts-head">
              <span>Request</span>
              <span>Destination</span>
              <span>Amount</span>
              <span>Action</span>
            </div>
            {withdrawals.map((item) => (
              <div className="acc-receipts-row" key={item.id}>
                <div>
                  <strong>#{item.id} · {item.affiliateCode}</strong>
                  <span>{item.status} · {formatDate(item.requestedAt)}</span>
                </div>
                <div>
                  <strong>{item.method}</strong>
                  <span>{item.accountName} · {item.accountNumber}</span>
                </div>
                <strong>{formatIDR(item.amount)}</strong>
                <div className="acc-action-panel">
                  {item.status === "pending" && (
                    <>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => void transition(item.id, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => void transition(item.id, "reject")}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {item.status === "approved" && (
                    <>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => void transition(item.id, "paid")}
                      >
                        Mark paid
                      </button>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => void transition(item.id, "reject")}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {item.status === "paid" && (
                    <span>{item.externalReference ?? "Paid"}</span>
                  )}
                  {item.status === "rejected" && (
                    <span>{item.rejectionReason ?? "Rejected"}</span>
                  )}
                  {item.status === "cancelled" && <span>Cancelled by partner</span>}
                </div>
              </div>
            ))}
            {withdrawals.length === 0 && (
              <div className="acc-empty">Belum ada withdrawal affiliate.</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
