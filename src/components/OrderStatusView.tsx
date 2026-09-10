"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicOrder } from "@/lib/order-public";
import {
  previewOrderStorageKey,
  type PreviewOrder,
} from "@/lib/order-preview";
import { formatIDR } from "@/lib/pricing";
import { STATUS_LABEL, STATUS_DESCRIPTION, STATUS_CTA, TIMELINE_STEPS, isTerminalStatus, calculateCountdown } from "@/lib/order-status";

/** Midtrans Snap callbacks type */
type SnapCallbacks = {
  onSuccess?: (result: unknown) => void;
  onPending?: (result: unknown) => void;
  onError?: (result: unknown) => void;
  onClose?: () => void;
  language?: "id" | "en";
};

/** Global Midtrans Snap injection */
declare global {
  interface Window {
    snap?: {
      pay: (token: string, options: SnapCallbacks) => void;
      embed: (
        token: string,
        options: SnapCallbacks & { embedId: string },
      ) => void;
      show?: () => void;
      hide?: () => void;
    };
  }
}

const SNAP_EMBED_ID = "midtrans-snap-container";

function formatOrderTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseISOOrFallback(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStatusTimeDisplay(order: PublicOrder | null) {
  if (!order) return null;

  // Prefer terminal_at, fallback to status_changed_at, then paid_at, then created_at
  const times = [
    { status: "success", label: "Selesai", at: order.terminalAt || order.statusChangedAt || order.payment.paidAt || order.createdAt },
    { status: "failed", label: "Gagal", at: order.terminalAt || order.statusChangedAt || order.createdAt },
    { status: "refunded", label: "Dikembalikan", at: order.terminalAt || order.statusChangedAt || order.createdAt },
    { status: "cancelled", label: "Dibatalkan", at: order.terminalAt || order.statusChangedAt || order.createdAt },
    { status: "paid", label: "Dibayar", at: order.payment.paidAt || order.createdAt },
  ];

  const active = times.find((t) => {
    if (t.status === "paid") return order.status === "paid" || order.status === "processing" || order.status === "success";
    return order.status === t.status;
  });

  if (!active?.at) return null;

  return {
    label: active.label,
    at: active.at,
  };
}

export default function OrderStatusView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewOrder | null | undefined>(undefined);
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapReady, setSnapReady] = useState(false);
  const embeddedOrderRef = useRef<string | null>(null);
  const midtransClientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY?.trim() ?? "";

  // Order access token for secure sharing
  const searchParams = useSearchParams();
  const [accessToken, setAccessToken] = useState<string | null>(() => searchParams.get("access_token"));

  async function loadLiveOrder(id: string, token?: string | null) {
    const url = new URL(`/api/orders/${encodeURIComponent(id)}`, window.location.origin);
    const activeToken = token ?? accessToken;

    if (activeToken) {
      url.searchParams.set("access_token", activeToken);
    }

    const response = await fetch(url.toString(), {
      cache: "no-store",
    });

    if (!response.ok) {
      if (response.status === 401) {
        setNotice("Akses tidak sah. Gunakan link yang benar atau minta akses baru.");
      }
      return null;
    }
    const data = (await response.json()) as { order?: PublicOrder };
    return data.order ?? null;
  }

  async function refreshStatus(id: string) {
    setBusy(true);
    setNotice("Memeriksa status langsung ke Midtrans...");

    try {
      const url = new URL(`/api/orders/${encodeURIComponent(id)}/refresh`, window.location.origin);
      if (accessToken) {
        url.searchParams.set("access_token", accessToken);
      }
      const response = await fetch(url.toString(), {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; order?: PublicOrder };

      if (!response.ok || !data.order) {
        setNotice(data.error ?? "Status Midtrans belum dapat diperbarui.");
        return;
      }

      setOrder(data.order);
      setNotice(`Status diperbarui: ${STATUS_LABEL[data.order.status]}.`);
    } catch {
      setNotice("Tidak dapat memeriksa status pembayaran.");
    } finally {
      setBusy(false);
    }
  }

  function snapCallbacks(id: string): SnapCallbacks {
    return {
      language: "id",
      onSuccess: () => {
        setNotice("Pembayaran selesai. Nambah sedang memverifikasi ke Midtrans...");
        void refreshStatus(id);
      },
      onPending: () => {
        setNotice("Pembayaran masih pending. Nambah sedang memverifikasi status...");
        void refreshStatus(id);
      },
      onError: () => {
        setNotice("Percobaan pembayaran gagal. Status akan diperiksa ulang.");
        void refreshStatus(id);
      },
      onClose: () => {
        setNotice("Panel pembayaran ditutup. Order masih dapat dibayar selama belum kedaluwarsa.");
      },
    };
  }

  // Fetch access token if missing (e.g. direct navigation)
  useEffect(() => {
    if (!orderId || accessToken) return;

    let mounted = true;
    async function fetchToken() {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/token`);
        if (!response.ok) return;
        const data = await response.json() as { token?: string };
        if (mounted && data.token) {
          setAccessToken(data.token);
          // Re-trigger load with the new token
          const liveOrder = await loadLiveOrder(orderId, data.token);
          if (mounted && liveOrder) {
            setOrder(liveOrder);
          }
        }
      } catch (error) {
        console.error("Failed to fetch access token", error);
      }
    }
    void fetchToken();
    return () => { mounted = false; };
  }, [orderId, accessToken]);

  // Load order data
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const liveOrder = await loadLiveOrder(orderId);
        if (!mounted) return;

        if (liveOrder) {
          setOrder(liveOrder);
          setPreview(null);
          return;
        }
      } catch {
        // Backward-compatible local preview fallback.
      }

      try {
        const raw = window.localStorage.getItem(previewOrderStorageKey(orderId));
        if (!raw) {
          if (mounted) {
            setOrder(null);
            setPreview(null);
          }
          return;
        }

        const parsed = JSON.parse(raw) as PreviewOrder;
        if (parsed.id !== orderId || parsed.mode !== "preview") {
          if (mounted) {
            setOrder(null);
            setPreview(null);
          }
          return;
        }

        if (mounted) {
          setPreview(parsed);
          setOrder(null);
        }
      } catch {
        if (mounted) {
          setOrder(null);
          setPreview(null);
        }
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  // Countdown timer for pending_payment
  const [countdown, setCountdown] = useState(() => calculateCountdown(order?.expiresAt));
  const [pollingInterval, setPollingInterval] = useState(5000);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (order?.expiresAt) {
      setCountdown(calculateCountdown(order.expiresAt));
    }
  }, [order?.expiresAt]);

  useEffect(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    if (order?.status === "pending_payment" && !countdown.isExpired) {
      countdownIntervalRef.current = setInterval(() => {
        const newCountdown = calculateCountdown(order.expiresAt);
        setCountdown(newCountdown);
        if (newCountdown.isExpired) {
          setNotice("Waktu pembayaran habis. Silakan buat pesanan baru.");
        }
      }, 1000);
    }

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [order?.status, order?.expiresAt, countdown.isExpired]);

  // Enhanced polling with exponential backoff
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    if (order?.status === "pending_payment") {
      pollingIntervalRef.current = setInterval(() => {
        void loadLiveOrder(order.id).then((fresh) => {
          if (fresh) {
            setOrder(fresh);
            setLastChecked(new Date().toLocaleTimeString("id-ID"));
            // Reset polling interval on status change
            setPollingInterval(5000);
          }
        });
      }, pollingInterval);
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [order?.id, order?.status, pollingInterval]);

  // Midtrans embedded payment
  useEffect(() => {
    if (
      !order ||
      order.status !== "pending_payment" ||
      !snapReady ||
      !window.snap ||
      !order.payment.snapToken ||
      embeddedOrderRef.current === order.id
    ) {
      return;
    }

    const container = document.getElementById(SNAP_EMBED_ID);
    if (!container) return;

    embeddedOrderRef.current = order.id;
    container.innerHTML = "";

    try {
      window.snap.embed(order.payment.snapToken, {
        embedId: SNAP_EMBED_ID,
        ...snapCallbacks(order.id),
      });
      setNotice("Pembayaran Midtrans dimuat langsung di halaman Nambah.");
    } catch {
      embeddedOrderRef.current = null;
      setNotice("Embedded Midtrans belum dapat dimuat. Muat ulang halaman atau gunakan pembayaran cadangan.");
    }
  }, [order?.id, order?.status, order?.payment.snapToken, snapReady]);

  // Shareable URL for sharing
  const shareableUrl = `${window.location.origin}/order/${order?.id}${accessToken ? `?access_token=${accessToken}` : ""}`;

  async function copyOrderId() {
    try {
      await navigator.clipboard.writeText(order?.id || "");
      setNotice("Order ID disalin ke clipboard.");
    } catch {
      setNotice("Gagal menyalin Order ID.");
    }
  }

  function openFallbackPayment() {
    if (order?.payment.redirectUrl) {
      window.open(order.payment.redirectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setNotice("URL pembayaran cadangan belum tersedia.");
  }

  async function createSandboxOrder() {
    if (!preview) return;
    setBusy(true);
    setNotice("");

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: preview.product.gameId,
          packageId: preview.product.packageId,
          paymentId: preview.payment.id,
          targetUserId: preview.account.userId,
          targetServerId: preview.account.serverId,
          promoCode: preview.promoCode,
          referralCode: preview.referralCode,
        }),
      });

      const data = (await response.json()) as { error?: string; order?: PublicOrder };
      if (!response.ok || !data.order) {
        setNotice(data.error ?? "Gagal membuat pembayaran Midtrans Sandbox.");
        return;
      }

      window.localStorage.removeItem(previewOrderStorageKey(preview.id));
      setPreview(null);
      setOrder(data.order);
      const tokenParam = data.accessToken ? `?access_token=${data.accessToken}` : "";
      router.replace(`/order/${encodeURIComponent(data.order.id)}${tokenParam}`);
      setNotice("Order Sandbox dibuat. Pembayaran akan dimuat di halaman ini.");
    } catch {
      setNotice("Tidak dapat menghubungi server pembayaran.");
    } finally {
      setBusy(false);
    }
  }

  // Determine current status display
  const isPreview = Boolean(preview);
  const liveStatus = order?.status ?? "pending_payment";
  const currentStatus = isPreview ? "pending_payment" : liveStatus;
  const isTerminal = isTerminalStatus(currentStatus);
  const statusCTAs = STATUS_CTA[currentStatus];

  // Timeline index based on actual reached status
  const timelineIndex = useMemo(() => {
    if (isPreview) return 0;
    return TIMELINE_STEPS.findIndex((step) => step.status === liveStatus);
  }, [liveStatus, isPreview]);

  if (preview === undefined || order === undefined) {
    return (
      <main>
        <header className="site-header shell order-header">
          <Link className="brand" href="/">
            <span className="brand-mark">N+</span>
            <span>Nambah</span>
          </Link>
        </header>
        <section className="order-status-shell shell">
          <div className="order-empty-card">Memuat status pesanan...</div>
        </section>
      </main>
    );
  }

  if (!preview && !order) {
    return (
      <main>
        <header className="site-header shell order-header">
          <Link className="brand" href="/">
            <span className="brand-mark">N+</span>
            <span>Nambah</span>
          </Link>
          <Link className="header-cta" href="/#topup">Top up lagi</Link>
        </header>
        <section className="order-status-shell shell">
          <div className="order-empty-card">
            <span className="eyebrow">Pesanan tidak ditemukan</span>
            <h1>Order ini tidak tersedia.</h1>
            <p>Buat pesanan baru dari halaman utama untuk melanjutkan ke Midtrans Sandbox.</p>
            <Link className="primary-button" href="/#topup">Buat pesanan baru <span>→</span></Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      {midtransClientKey && (
        <Script
          id="midtrans-snap-sandbox"
          src="https://app.sandbox.midtrans.com/snap/snap.js"
          data-client-key={midtransClientKey}
          strategy="afterInteractive"
          onLoad={() => setSnapReady(true)}
        />
      )}

      <header className="site-header shell order-header">
        <Link className="brand" href="/">
          <span className="brand-mark">N+</span>
          <span>Nambah</span>
        </Link>
        <div className="order-header-center">Status pesanan</div>
        <Link className="header-cta" href="/#topup">Top up lagi</Link>
      </header>

      <section className="order-status-shell shell">
        <div className="order-status-title">
          <div>
            <span className="eyebrow">Midtrans Embedded</span>
            <h1>{isPreview ? "Siap membuat pembayaran." : STATUS_LABEL[liveStatus]}</h1>
            <p>
              {isPreview
                ? "Harga akan divalidasi ulang di server sebelum order dan token pembayaran dibuat."
                : STATUS_DESCRIPTION[liveStatus]}
            </p>
            {lastChecked && (
              <span className="order-last-checked">Terakhir diperiksa: {lastChecked}</span>
            )}
            {countdown.totalSeconds > 0 && !countdown.isExpired && !isPreview && (
              <span className={`order-countdown ${countdown.isExpired ? "expired" : ""}`}>
                Waktu habis: {countdown.display}
              </span>
            )}
            {countdown.isExpired && !isPreview && (
              <span className="order-countdown expired">Waktu habis</span>
            )}
          </div>
          <span className="order-mode-badge">
            SANDBOX · EMBEDDED
          </span>
        </div>

        <div className="order-status-grid">
          <article className="order-main-card">
            <div className="order-main-head">
              <div className="order-product-identity">
                <span className="order-product-mark" style={{ background: order?.product.accent }}>
                  {order?.product.initials}
                </span>
                <div>
                  <small>{order?.product.shortName}</small>
                  <strong>{order?.product.packageLabel}</strong>
                </div>
              </div>
              <span className="order-status-pill">
                {isPreview ? "Belum dibuat" : STATUS_LABEL[liveStatus]}
              </span>
            </div>

            <div className="order-id-row">
              <div>
                <small>Order ID</small>
                <strong>{order?.id}</strong>
                <button
                  className="copy-order-id-button"
                  onClick={copyOrderId}
                  title="Salin Order ID"
                >
                  Salin
                </button>
              </div>
              <div>
                <small>Dibuat</small>
                <strong>{order?.createdAt ? formatOrderTime(order.createdAt) : "-"}</strong>
              </div>
              {order?.statusChangedAt && (
                <div>
                  <small>Status diubah</small>
                  <strong>{formatOrderTime(order.statusChangedAt)}</strong>
                </div>
              )}
              {order?.terminalAt && (
                <div>
                  <small>Terminal</small>
                  <strong>{formatOrderTime(order.terminalAt)}</strong>
                </div>
              )}
            </div>

            {/* Timeline Section */}
            <div className="order-timeline">
              {TIMELINE_STEPS.map((item, index) => {
                const isCompleted = !isPreview && index <= timelineIndex;
                return (
                  <div
                    className={`order-timeline-item ${isCompleted ? "current" : "upcoming"}`}
                    key={item.title}
                  >
                    <div className="timeline-marker">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Payment Section */}
            {isPreview ? (
              <div className="order-payment-preview">
                <div>
                  <small>Metode pembayaran</small>
                  <strong>{order?.payment.name}</strong>
                  <p>{order?.payment.detail}</p>
                </div>
                <button type="button" disabled={busy} onClick={() => void createSandboxOrder()}>
                  {busy ? "Memproses..." : "Buat pembayaran Sandbox"}
                </button>
              </div>
            ) : liveStatus === "pending_payment" ? (
              <div className="midtrans-native-section">
                <div className="midtrans-native-head">
                  <div>
                    <small>Pembayaran</small>
                    <strong>{order?.payment.name}</strong>
                    <p>{order?.payment.detail}</p>
                  </div>
                  <span>Midtrans Sandbox</span>
                </div>

                {!midtransClientKey && (
                  <div className="midtrans-native-warning">
                    NEXT_PUBLIC_MIDTRANS_CLIENT_KEY belum tersedia. Embedded checkout tidak dapat dimuat.
                  </div>
                )}

                {midtransClientKey && !snapReady && (
                  <div className="midtrans-native-loading">Memuat pembayaran Midtrans...</div>
                )}

                <div id={SNAP_EMBED_ID} className="midtrans-snap-container" />

                <div className="midtrans-native-footer">
                  <span>Pembayaran tetap diverifikasi server-side.</span>
                  {(!midtransClientKey || !snapReady) && order?.payment.redirectUrl && (
                    <button type="button" onClick={openFallbackPayment}>Buka pembayaran cadangan</button>
                  )}
                </div>
              </div>
            ) : (
              <div className="order-payment-preview">
                <div>
                  <small>Metode pembayaran</small>
                  <strong>{order?.payment.name}</strong>
                  <p>{order?.payment.detail}</p>
                </div>
                <button type="button" disabled>{STATUS_LABEL[liveStatus]}</button>
              </div>
            )}

            {notice && <p className="order-preview-note">{notice}</p>}
          </article>

          <aside className="order-summary-card">
            <div className="order-summary-head">
              <span>Ringkasan</span>
              <small>{isPreview ? "Preview" : "Sandbox"}</small>
            </div>

            <dl className="order-detail-list">
              <div><dt>Produk</dt><dd>{order?.product.gameName}</dd></div>
              <div><dt>Nominal</dt><dd>{order?.product.packageLabel}</dd></div>
              <div><dt>User ID</dt><dd>{order?.account.userId}</dd></div>
              {order?.account.serverId && <div><dt>Server / Zone</dt><dd>{order.account.serverId}</dd></div>}
              {order?.promoCode && <div><dt>Promo</dt><dd>{order.promoCode}</dd></div>}
              {order?.referralCode && <div><dt>Referral</dt><dd>{order.referralCode}</dd></div>}
              {order?.payment.paymentType && <div><dt>Channel Midtrans</dt><dd>{order.payment.paymentType}</dd></div>}
            </dl>

            <div className="order-price-breakdown">
              <div><span>Harga Nambah</span><strong>{order?.pricing.sellingPrice ? formatIDR(order.pricing.sellingPrice) : "-"}</strong></div>
              {order?.pricing.promotionDiscount && order.pricing.promotionDiscount > 0 && (
                <div className="saving"><span>Promo</span><strong>-{formatIDR(order.pricing.promotionDiscount)}</strong></div>
              )}
              {order?.pricing.referralDiscount && order.pricing.referralDiscount > 0 && (
                <div className="referral-saving"><span>Benefit referral</span><strong>-{formatIDR(order.pricing.referralDiscount)}</strong></div>
              )}
              <div><span>Biaya pembayaran</span><strong>{order?.pricing.customerPaymentFee ? formatIDR(order.pricing.customerPaymentFee) : "-"}</strong></div>
            </div>

            <div className="order-grand-total">
              <span>Total</span>
              <strong>{order?.pricing.finalPrice ? formatIDR(order.pricing.finalPrice) : "-"}</strong>
            </div>

            {/* Action Buttons */}
            {statusCTAs.length > 0 && (
              <div className="order-summary-actions">
                {statusCTAs.map((cta, index) => {
                  const isPrimary = cta.action === "pay" || cta.action === "new_order" || cta.action === "refresh";

                  const handleClick = () => {
                    switch (cta.action) {
                      case "copy":
                        copyOrderId();
                        break;
                      case "pay":
                        // Already embedded, do nothing
                        break;
                      case "refresh":
                        if (!busy && order?.id) refreshStatus(order.id);
                        break;
                      case "new_order":
                        router.push("/#topup");
                        break;
                      case "support":
                        window.open("mailto:support@nambah.com?subject=Order%20Inquiry");
                        break;
                    }
                  };

                  return (
                    <button
                      key={index}
                      className={`cta-button ${isPrimary ? "primary-button" : "text-link"}`}
                      onClick={handleClick}
                      disabled={busy}
                    >
                      {cta.label}
                    </button>
                  );
                })}
              </div>
            )}

            {!isPreview && liveStatus === "pending_payment" && (
              <button className="primary-button full" type="button" disabled={busy} onClick={() => void refreshStatus(order.id)}>
                Cek status Midtrans <span>↻</span>
              </button>
            )}

            <div className="order-secondary-links">
              <Link className="order-secondary-link" href="/#topup">Buat pesanan lain</Link>
              {accessToken && (
                <button
                  className="order-secondary-link"
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: "Order", text: `Order ${order?.id}`, url: shareableUrl });
                    } else {
                      // Fallback for mobile/web browsers without native share
                      navigator.clipboard.writeText(shareableUrl);
                      setNotice("Link disalin ke clipboard");
                    }
                  }}
                >
                  Bagikan status
                </button>
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}