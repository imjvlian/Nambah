"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatIDR } from "@/lib/pricing";

/**
 * Antrean pencairan afiliasi.
 *
 * HALAMAN INI HANYA TENTANG UANG KELUAR.
 *
 * Dulu halaman ini juga memegang pembuatan mitra, penyetelan komisi,
 * pengaitan kode ke akun, dan daftar seluruh mitra. Tidak satu pun
 * dari itu punya hubungannya dengan pencairan - dan akibatnya seksi
 * "Afiliasi" di dashboard tidak bisa membuat mitra kecuali dengan
 * berpindah ke halaman yang namanya soal pencairan.
 *
 * Manajemen mitra sekarang ada di `AffiliateDirectoryPanel`, yang
 * dirender di seksi Afiliasi. Halaman ini tinggal satu pertanyaan:
 * uang mana yang perlu ditransfer, dan ke siapa.
 */

type WithdrawalRow = {
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
};

type WithdrawalPayload = {
  withdrawals: WithdrawalRow[];
  error?: string;
};

type AffiliateStats = {
  available: number;
  reserved: number;
  withdrawn: number;
};

/**
 * Status pencairan, diterjemahkan.
 *
 * `reserved` dihitung dari request `pending` dan `approved`: keduanya
 * menahan komisi dari saldo yang bisa ditarik, jadi nominalnya sudah
 * tidak bisa diminta partner Though belum ditransfer.
 */
const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  paid: "Lunas",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

/**
 * Urutan antrean.
 *
 * Yang menunggu diperiksa lebih dulu, lalu yang sudah disetujui tapi
 * belum ditransfer. Urutan bawaan dari database adalah tanggal DESC,
 * yang berarti request yang paling baru selalu menutup antrean - dan
 * request paling lama justru tenggelam di paling bawah.
 */
const QUEUE_ORDER = ["pending", "approved", "paid", "rejected", "cancelled"] as const;

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
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [stats, setStats] = useState<AffiliateStats>({
    available: 0,
    reserved: 0,
    withdrawn: 0,
  });
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{
    id: number;
    action: "approve" | "reject" | "paid";
  } | null>(null);
  const [dialogText, setDialogText] = useState("");

  /*
   * Hanya superadmin yang boleh menyentuh uang keluar.
   *
   * TOKEN API (`legacy`) juga diizinkan karena memang adalah jalur
   * otomatis, bukan sesi orang yang menekan tombol.
   */
  const canPayout = role === "superadmin" || role === "legacy";

  const load = useCallback(async () => {
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

    const affiliateData = (await affiliateResponse.json()) as {
      stats?: AffiliateStats;
      error?: string;
    };
    const withdrawalData =
      (await withdrawalResponse.json()) as WithdrawalPayload;
    const sessionData = (await sessionResponse.json()) as {
      role?: string;
      error?: string;
    };

    if (!withdrawalResponse.ok) {
      throw new Error(withdrawalData.error ?? "Pencairan gagal dimuat.");
    }

    setWithdrawals(withdrawalData.withdrawals ?? []);
    setStats({
      available: affiliateData.stats?.available ?? 0,
      reserved: affiliateData.stats?.reserved ?? 0,
      withdrawn: affiliateData.stats?.withdrawn ?? 0,
    });
    setRole(sessionData.role ?? "");
    setError("");
  }, []);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Pencairan gagal dimuat."),
    );
  }, [load]);

  const activeCount = withdrawals.filter(
    (item) => item.status === "pending" || item.status === "approved",
  ).length;

  const queued = [...withdrawals].sort((a, b) => {
    const rank =
      QUEUE_ORDER.indexOf(a.status as (typeof QUEUE_ORDER)[number]) -
      QUEUE_ORDER.indexOf(b.status as (typeof QUEUE_ORDER)[number]);
    if (rank !== 0) return rank;
    return a.id - b.id;
  });

  /*
   * Syarat boleh mengirim mengikuti validasi server supaya operator
   * tidak gagal setelah menekan.
   *
   * Server memakai 3 karakter untuk keduanya; di sini 5 supaya alasan
   * penolakan yang cuma "ok" tidak sampai ke partner.
   */
  const dialogBlocked = dialog !== null && dialogText.trim().length < 5;

  const dialogTitle =
    dialog === null
      ? ""
      : dialog.action === "approve"
        ? "Setujui pencairan"
        : dialog.action === "paid"
          ? "Tandai sudah dibayar"
          : "Tolak pencairan";

  const dialogHint =
    dialog === null
      ? ""
      : dialog.action === "approve"
        ? "Menyetujui berarti dana dialokasikan ke request ini. Transfer tetap dilakukan di luar sistem."
        : dialog.action === "paid"
          ? "Tandai setelah transfer benar-benar dikirim. Reference dipakai untuk rekonsiliasi."
          : "Alasan akan dibaca partner. Tulis yang bisa ditindaklanjuti.";

  async function transition(
    withdrawalId: number,
    action: "approve" | "reject" | "paid",
    text: string,
  ) {
    // Approve tidak butuh teks, tapi tetap mengirim string kosong supaya
    // bentuk payload sama untuk ketiga aksi.
    const reason = action === "reject" ? text.trim() : "";
    const externalReference = action === "paid" ? text.trim() : "";

    setBusy(action + ":" + withdrawalId);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/affiliates/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawalId, action, reason, externalReference }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Pencairan gagal diperbarui.");
      }

      setDialog(null);
      setDialogText("");
      await load();
      setNotice(
        action === "approve"
          ? "Pencairan disetujui. Sekarang transfer dana ke partner."
          : action === "paid"
            ? "Pencairan ditandai lunas."
            : "Pencairan ditolak.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Pencairan gagal diperbarui.",
      );
    } finally {
      setBusy("");
    }
  }

  function openDialog(id: number, action: "approve" | "reject" | "paid") {
    setDialog({ id, action });
    setDialogText("");
  }

  return (
    <main className="acc-page-sub">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            <small>Admin / Afiliasi</small>
            <strong>Pencairan</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin?seksi=affiliates">Kelola mitra →</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero">
            <div>
              <span className="acc-eyebrow">Pencairan afiliasi</span>
              <h1>Tinjau dulu, bayar di luar sistem.</h1>
              <p>
                Alokasi komisi dikunci secara atomik, jadi dana yang sedang
                diproses tidak bisa diminta dua kali. Transfer tetap dilakukan
                operator di luar sistem, lalu superadmin menandai request lunas
                dengan reference pembayaran.
              </p>
            </div>
          </section>

          {notice ? (
            <div className="acc-global-notice" role="status">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="acc-global-notice error" role="alert">
              {error}
            </div>
          ) : null}

          {/*
            Tiga angka, bukan empat.
            "Role" dipindah ke keterangan di bawah antrean: kartu metrik
            untuk izin akses bukan informasi operasional, dan menampilkan
            angka "superadmin" di antara nominal rupiah membuat orang salah
            baca.
          */}
          <div className="acc-metrics acc-metrics-three">
            <article>
              <small>Siap dicairkan</small>
              <strong>{formatIDR(stats.available)}</strong>
              <span>belum dialokasikan ke request</span>
            </article>
            <article>
              <small>Sedang diproses</small>
              <strong>{formatIDR(stats.reserved)}</strong>
              <span>{activeCount} request aktif</span>
            </article>
            <article>
              <small>Sudah dibayar</small>
              <strong>{formatIDR(stats.withdrawn)}</strong>
              <span>pencairan selesai</span>
            </article>
          </div>

          <div className="acc-table-card">
            <div className="acc-receipts-head">
              <span>Request</span>
              <span>Tujuan</span>
              <span>Nominal</span>
              <span>Aksi</span>
            </div>

            {queued.length === 0 ? (
              <div className="acc-empty">Belum ada permintaan pencairan.</div>
            ) : null}

            {queued.map((item) => (
              <div className="acc-receipts-row" key={item.id}>
                <div>
                  <strong>#{item.id} · {item.affiliateCode}</strong>
                  <span>
                    {WITHDRAWAL_STATUS_LABEL[item.status] ?? item.status} ·{" "}
                    {formatDate(item.requestedAt)}
                  </span>
                </div>
                <div>
                  <strong>{item.method}</strong>
                  <span>
                    {item.accountName} · {item.accountNumber}
                  </span>
                </div>
                <strong>{formatIDR(item.amount)}</strong>
                <div className="acc-action-panel">
                  {item.status === "pending" || item.status === "approved" ? (
                    <>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() =>
                          openDialog(
                            item.id,
                            item.status === "pending" ? "approve" : "paid",
                          )
                        }
                      >
                        {item.status === "pending" ? "Setujui" : "Tandai lunas"}
                      </button>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => openDialog(item.id, "reject")}
                      >
                        Tolak
                      </button>
                    </>
                  ) : null}

                  {item.status === "paid" ? (
                    <span>{item.externalReference ?? "Lunas"}</span>
                  ) : null}
                  {item.status === "rejected" ? (
                    <span>{item.rejectionReason ?? "Ditolak"}</span>
                  ) : null}
                  {item.status === "cancelled" ? (
                    <span>Dibatalkan partner</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {!canPayout ? (
            <p className="acc-payment-hint">
              Role Anda ({role || "tidak dikenal"}) bisa melihat antrean tapi
              tidak bisa menyetujui. Tindakan pencairan hanya untuk superadmin.
            </p>
          ) : null}

          {dialog !== null ? (
            <div className="acc-affiliate-dialog" role="dialog" aria-modal="true">
              <div className="acc-affiliate-dialog-card">
                <h3>{dialogTitle}</h3>
                <p>{dialogHint}</p>

                <label className="acc-field">
                  <span>
                    {dialog.action === "paid"
                      ? "Reference pembayaran"
                      : dialog.action === "reject"
                        ? "Alasan penolakan"
                        : "Catatan (opsional)"}
                  </span>
                  <input
                    value={dialogText}
                    onChange={(event) => setDialogText(event.target.value)}
                    placeholder={
                      dialog.action === "paid"
                        ? "Contoh: TRF/2026/11/00812"
                        : dialog.action === "reject"
                          ? "Minimal 5 karakter"
                          : "Contoh: saldo rekening partner sudah dicek"
                    }
                    autoFocus={dialog.action !== "approve"}
                  />
                </label>

                <div className="acc-affiliate-dialog-actions">
                  <button
                    type="button"
                    className="acc-primary-link"
                    disabled={dialogBlocked || Boolean(busy)}
                    onClick={() =>
                      void transition(dialog.id, dialog.action, dialogText)
                    }
                  >
                    {dialog.action === "approve"
                      ? "Setujui"
                      : dialog.action === "paid"
                        ? "Tandai lunas"
                        : "Kirim penolakan"}
                  </button>
                  <button
                    type="button"
                    className="admin-secondary-button"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setDialog(null);
                      setDialogText("");
                    }}
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}