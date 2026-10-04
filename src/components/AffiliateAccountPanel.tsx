"use client";

import { useEffect, useState } from "react";
import { formatIDR } from "@/lib/pricing";

type AffiliateData = {
  affiliate: null | {
    code: string;
    displayName: string;
    commissionRate: number;
    status: string;
    pending: number;
    available: number;
    reserved: number;
    withdrawn: number;
  };
  withdrawals: Array<{
    id: number;
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

function maskAccount(value: string) {
  if (value.length <= 4) return value;
  return "••••" + value.slice(-4);
}

export default function AffiliateAccountPanel() {
  const [data, setData] = useState<AffiliateData | null>(null);
  const [draft, setDraft] = useState({
    amount: "",
    method: "",
    accountName: "",
    accountNumber: "",
  });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch("/api/account/affiliate", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = (await response.json()) as AffiliateData;
    if (!response.ok) {
      throw new Error(body.error ?? "Data affiliate gagal dimuat.");
    }
    setData(body);
  }

  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Data affiliate gagal dimuat."),
    );
  }, []);

  async function requestWithdrawal() {
    setBusy("request");
    setNotice("");
    try {
      const amount = Number(draft.amount);
      const response = await fetch("/api/account/affiliate/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          amount,
          method: draft.method,
          accountName: draft.accountName,
          accountNumber: draft.accountNumber,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Withdrawal gagal dibuat.");
      }
      setDraft({
        amount: "",
        method: "",
        accountName: "",
        accountNumber: "",
      });
      await load();
      setNotice("Withdrawal dikirim dan menunggu review admin.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Withdrawal gagal dibuat.");
    } finally {
      setBusy("");
    }
  }

  async function cancelWithdrawal(withdrawalId: number) {
    setBusy("cancel:" + withdrawalId);
    setNotice("");
    try {
      const response = await fetch("/api/account/affiliate/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ withdrawalId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Withdrawal gagal dibatalkan.");
      }
      await load();
      setNotice("Withdrawal dibatalkan.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Withdrawal gagal dibatalkan.",
      );
    } finally {
      setBusy("");
    }
  }

  if (!data?.affiliate) return null;

  const affiliate = data.affiliate;
  const activeWithdrawal = data.withdrawals.find((item) =>
    item.status === "pending" || item.status === "approved",
  );

  return (
    <section className="account-profile-settings">
      <div className="account-section-head">
        <div>
          <span className="eyebrow">Affiliate · {affiliate.code}</span>
          <h2>Komisi & withdrawal.</h2>
        </div>
        <span className="account-profile-saved">
          {Math.round(affiliate.commissionRate * 100)}% dari profit eligible
        </span>
      </div>

      <div className="account-points-stats">
        <article>
          <small>Pending</small>
          <strong>{formatIDR(affiliate.pending)}</strong>
        </article>
        <article>
          <small>Tersedia</small>
          <strong>{formatIDR(affiliate.available)}</strong>
        </article>
        <article>
          <small>Dalam proses</small>
          <strong>{formatIDR(affiliate.reserved)}</strong>
        </article>
        <article>
          <small>Sudah dibayar</small>
          <strong>{formatIDR(affiliate.withdrawn)}</strong>
        </article>
      </div>

      <div className="account-profile-form">
        <label>
          <span>Nominal withdrawal</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, affiliate.available)}
            value={draft.amount}
            onChange={(event) =>
              setDraft((current) => ({ ...current, amount: event.target.value }))
            }
            placeholder={affiliate.available > 0 ? String(affiliate.available) : "0"}
          />
        </label>
        <label>
          <span>Bank / e-wallet</span>
          <input
            value={draft.method}
            onChange={(event) =>
              setDraft((current) => ({ ...current, method: event.target.value }))
            }
            placeholder="BCA / GoPay / DANA"
          />
        </label>
        <label>
          <span>Nama rekening</span>
          <input
            value={draft.accountName}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                accountName: event.target.value,
              }))
            }
            placeholder="Nama pemilik rekening"
          />
        </label>
        <label>
          <span>Nomor rekening / akun</span>
          <input
            value={draft.accountNumber}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                accountNumber: event.target.value,
              }))
            }
            placeholder="Nomor tujuan pembayaran"
          />
        </label>
        <button
          type="button"
          disabled={
            busy === "request" ||
            affiliate.available <= 0 ||
            Boolean(activeWithdrawal)
          }
          onClick={() => void requestWithdrawal()}
        >
          {busy === "request"
            ? "Mengirim..."
            : activeWithdrawal
              ? "Masih ada withdrawal aktif"
              : "Ajukan withdrawal"}
        </button>
      </div>

      {notice && <p className="account-profile-message">{notice}</p>}

      <div className="account-points-ledger">
        <div className="account-points-ledger-head">
          <strong>Riwayat withdrawal</strong>
          <span>{data.withdrawals.length} request terbaru</span>
        </div>
        {data.withdrawals.length === 0 ? (
          <div className="account-points-empty">Belum ada withdrawal.</div>
        ) : (
          data.withdrawals.map((item) => (
            <div className="account-point-row" key={item.id}>
              <span className={"account-point-icon type-" + item.status}>AF</span>
              <div>
                <strong>
                  {item.method} · {maskAccount(item.accountNumber)}
                </strong>
                <small>
                  {item.status} · {formatDate(item.requestedAt)}
                  {item.rejectionReason ? " · " + item.rejectionReason : ""}
                </small>
              </div>
              <b>{formatIDR(item.amount)}</b>
              {item.status === "pending" && (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void cancelWithdrawal(item.id)}
                >
                  {busy === "cancel:" + item.id ? "..." : "Batalkan"}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
