"use client";

import { useCallback, useEffect, useState } from "react";
import { formatIDR } from "@/lib/pricing";

/**
 * Monitor kinerja affiliate.
 *
 * Satu baris per affiliate. Kolom yang ditampilkan:
 *
 *   klik · pesanan · konversi · komisi
 *
 * Konversi sengaja "—" kalau belum ada klik. "0 klik → 0%" menyesatkan:
 * affiliate yang belum pernah dipromosikan terlihat sama dengan affiliate yang
 * 1000 klik tapi tidak ada yang beli.
 *
 * "Komisi" dihitung dari `commissions` yang sudah terisi otomatis — panel ini
 * tidak menghitung ulang, hanya menjumlahkan.
 */

type PerformanceRow = {
  code: string;
  displayName: string;
  hasOwner: boolean;
  status: string;
  commissionRate: number;
  clicks: number;
  orders: number;
  conversion: number | null;
  commissionPending: number;
  commissionAvailable: number;
  commissionWithdrawn: number;
  commissionLifetime: number;
};

type PerformanceData = {
  rows: PerformanceRow[];
  totals: {
    affiliates: number;
    active: number;
    clicks: number;
    orders: number;
    commissionLifetime: number;
    commissionAvailable: number;
  };
  windowDays: number;
};

type RequestRow = {
  id: number;
  userId: string;
  displayName: string;
  whatsapp: string;
  motivation: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  otherUrl: string;
  status: "pending" | "approved" | "rejected";
  grantedCode: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

const WINDOWS = [7, 30, 90] as const;

const LINK_LABELS: Array<[keyof Pick<RequestRow, "instagram" | "tiktok" | "youtube" | "otherUrl">, string]> = [
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["otherUrl", "Link lain"],
];

/**
 * Link dari form applicant ditampilkan apa adanya, jadi harus dibuat bisa
 * diklik tanpa merusak kalau isinya rusak.
 *
 * Applicant menempelkan link dengan tangan — ada yang pakai `https://`, ada
 * yang tidak, ada yang ketik `instagram.com/namachannel` di field Instagram.
 * Yang pertama bisa jadi href langsung; yang kedua harus dipaskan jadi URL
 * lengkap. Kalau gagal dibuat URL, ditampilkan sebagai teks biasa — link yang
 * rusak lebih baik terlihat daripada hilang.
 */
function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    // Hanya http/https. `javascript:` dari form applicant akan dieksekusi kalau
    // dipakai apa adanya sebagai href.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function percent(value: number | null) {
  if (value === null) return "—";
  return (value * 100).toFixed(1).replace(/\.0$/, "") + "%";
}

export default function AffiliatePerformancePanel() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewing, setReviewing] = useState<number | null>(null);
  /*
   * Mode peninjauan, bukan lagi ditebak dari isi `reason`.
   *
   * Versi lama memisahkan "approve" dan "reject" dengan memeriksa
   * `reviewForm.reason` dan `reviewForm.reason.trim()` pada baris yang
   * bersebelahan, dan tombol Tolak mengisi `reason: " "` - satu spasi.
   *
   * Jadi hanya karena spasi itu truthy sedangkan spasi.trim() falsy,
   * ketiga blok form bergantian dengan benar. Dua definisi "kosong" untuk
   * satu konsep: rapuh, dan tidak ada satu pun test yang bisa memegangnya.
   * Satu enum membuat maksudnya terbaca dan tidak bisa rusak diam-diam.
   */
  const [reviewMode, setReviewMode] = useState<"approve" | "reject">("approve");
  const [reviewForm, setReviewForm] = useState({ code: "", commissionRate: "0.2", reason: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perfResponse, reqResponse] = await Promise.all([
        fetch(`/api/admin/affiliate-performance?days=${days}`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetch("/api/admin/affiliate-requests?status=pending", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ]);

      const perf = (await perfResponse.json()) as PerformanceData & { error?: string };
      if (!perfResponse.ok) {
        setError(perf.error ?? "Data affiliate tidak dapat dimuat.");
      } else {
        setData(perf);
        setError("");
      }

      if (reqResponse.ok) {
        const req = (await reqResponse.json()) as { requests?: RequestRow[] };
        setRequests(req.requests ?? []);
      }
    } catch {
      setError("Data affiliate tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: number, decision: "approve" | "reject") {
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/affiliate-requests", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          decision,
          code: decision === "approve" ? reviewForm.code : undefined,
          commissionRate:
            decision === "approve" ? Number(reviewForm.commissionRate) : undefined,
          rejectionReason: decision === "reject" ? reviewForm.reason : undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string; code?: string };
      if (!response.ok) {
        setError(payload.error ?? "Keputusan gagal diproses.");
        return;
      }
      setNotice(
        decision === "approve"
          ? `Affiliate dibuat dengan kode ${payload.code}.`
          : "Permintaan ditolak.",
      );
      setReviewing(null);
      setReviewMode("approve");
      setReviewForm({ code: "", commissionRate: "0.2", reason: "" });
      await load();
    } catch {
      setError("Keputusan gagal diproses.");
    }
  }

  if (loading && !data) {
    return <div className="acc-notice">Memuat data affiliate...</div>;
  }

  return (
    <div className="acc-affiliate-monitor">
      {requests.length > 0 && (
        <section className="acc-panel">
          <header className="acc-panel-head">
            <h3>Permintaan baru ({requests.length})</h3>
            <p>
              Rate komisi ditentukan di sini — pemohon tidak pernah memilih
              sendiri.
            </p>
          </header>
          {requests.map((item) => (
            <div className="acc-request" key={item.id}>
              <div className="acc-request-head">
                <strong>{item.displayName}</strong>
                <a href={"tel:" + item.whatsapp}>{item.whatsapp}</a>
              </div>
              <p className="acc-request-motivation">{item.motivation}</p>

              <div className="acc-request-links">
                {LINK_LABELS.map(([key, label]) => {
                  const raw = item[key];
                  if (!raw) return null;
                  const href = safeHref(raw);
                  return href ? (
                    <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
                      {label}
                    </a>
                  ) : (
                    // Link tidak bisa dibuka — tampilkan apa adanya supaya
                    // admin tetap bisa membaca dan menilai manual.
                    <span key={key} className="broken" title={raw}>
                      {label}
                    </span>
                  );
                })}
                {LINK_LABELS.every(([key]) => !item[key]) ? (
                  <span className="broken">Tidak ada link</span>
                ) : null}
              </div>

              {reviewing === item.id ? (
                <div className="acc-request-form">
                  {reviewMode === "approve" ? (
                    <>
                      <label>
                        <span>Kode affiliate (opsional)</span>
                        <input
                          value={reviewForm.code}
                          onChange={(event) =>
                            setReviewForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
                          }
                          placeholder="Kosongkan untuk dibuat otomatis"
                        />
                      </label>
                      <label>
                        <span>Rate komisi</span>
                        <input
                          inputMode="decimal"
                          value={reviewForm.commissionRate}
                          onChange={(event) =>
                            setReviewForm((current) => ({ ...current, commissionRate: event.target.value }))
                          }
                          placeholder="0.2 untuk 20%"
                        />
                      </label>
                      <div className="acc-request-actions">
                        <button type="button" onClick={() => void decide(item.id, "approve")}>
                          Setujui
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setReviewMode("reject")}
                        >
                          Tolak
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setReviewing(null)}
                        >
                          Batal
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>Alasan penolakan</span>
                        <input
                          value={reviewForm.reason}
                          onChange={(event) =>
                            setReviewForm((current) => ({ ...current, reason: event.target.value }))
                          }
                          placeholder="Minimal 5 karakter"
                        />
                      </label>
                      <div className="acc-request-actions">
                        <button
                          type="button"
                          disabled={reviewForm.reason.trim().length < 5}
                          onClick={() => void decide(item.id, "reject")}
                        >
                          Kirim penolakan
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setReviewMode("approve")}
                        >
                          Kembali
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setReviewing(item.id);
                    setReviewMode("approve");
                    setReviewForm({ code: "", commissionRate: "0.2", reason: "" });
                  }}
                >
                  Tinjau
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="acc-panel">
        <header className="acc-panel-head">
          <h3>Kinerja affiliate</h3>
          <div className="acc-window-picker">
            {WINDOWS.map((window) => (
              <button
                key={window}
                type="button"
                className={days === window ? "active" : ""}
                onClick={() => setDays(window)}
              >
                {window} hari
              </button>
            ))}
          </div>
        </header>

        {data && (
          <>
            <div className="acc-metrics">
              <article>
                <small>Affiliate</small>
                <strong>{data.totals.affiliates}</strong>
              </article>
              <article>
                <small>Aktif</small>
                <strong>{data.totals.active}</strong>
              </article>
              <article>
                <small>Klik ({data.windowDays} hari)</small>
                <strong>{data.totals.clicks}</strong>
              </article>
              <article>
                <small>Pesanan</small>
                <strong>{data.totals.orders}</strong>
              </article>
              <article>
                <small>Komisi total</small>
                <strong>{formatIDR(data.totals.commissionLifetime)}</strong>
              </article>
              <article>
                <small>Siap dicairkan</small>
                <strong>{formatIDR(data.totals.commissionAvailable)}</strong>
              </article>
            </div>

            <div className="acc-table-card">
              <div className="acc-affiliate-head">
                <span>Kode</span>
                <span>Rate</span>
                <span>Klik</span>
                <span>Pesanan</span>
                <span>Konversi</span>
                <span>Komisi</span>
                <span>Siap</span>
              </div>
              {data.rows.length === 0 ? (
                <div className="acc-empty">Belum ada affiliate.</div>
              ) : (
                data.rows.map((row) => (
                  <div className="acc-affiliate-row" key={row.code}>
                    <div>
                      <strong>{row.displayName}</strong>
                      <span className="acc-affiliate-code">
                        /r/{row.code}
                        {row.hasOwner ? null : " · program bawaan"}
                      </span>
                    </div>
                    <span>{Math.round(row.commissionRate * 100)}%</span>
                    <span>{row.clicks}</span>
                    <span>{row.orders}</span>
                    <span>{percent(row.conversion)}</span>
                    <strong>{formatIDR(row.commissionLifetime)}</strong>
                    <strong>{formatIDR(row.commissionAvailable)}</strong>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {notice && <p className="acc-notice">{notice}</p>}
      {error && <p className="acc-notice error">{error}</p>}
    </div>
  );
}
