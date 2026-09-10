"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PublicOrder } from "@/lib/order-public";
import {
  previewOrderStorageKey,
  type PreviewOrder,
} from "@/lib/order-preview";
import { formatIDR } from "@/lib/pricing";
import {
  STATUS_CTA,
  STATUS_DESCRIPTION,
  STATUS_LABEL,
  TIMELINE_STEPS,
  calculateCountdown,
} from "@/lib/order-status";

type SnapCallbacks = {
  onSuccess?: (result: unknown) => void;
  onPending?: (result: unknown) => void;
  onError?: (result: unknown) => void;
  onClose?: () => void;
  language?: "id" | "en";
};

type OrderApiResponse = {
  error?: string;
  order?: PublicOrder;
  accessToken?: string;
};

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

export default function OrderStatusView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    searchParams.get("access_token"),
  );
  const [preview, setPreview] = useState<PreviewOrder | null | undefined>(undefined);
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapReady, setSnapReady] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [countdown, setCountdown] = useState(() => calculateCountdown(null));
  const embeddedOrderRef = useRef<string | null>(null);
  const midtransClientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY?.trim() ?? "";

  async function loadLiveOrder(id: string, token = accessToken) {
    const url = new URL(`/api/orders/${encodeURIComponent(id)}`, window.location.origin);
    if (token) url.searchParams.set("access_token", token);

    const response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) {
      if (response.status === 401) setAccessDenied(true);
      return null;
    }

    setAccessDenied(false);
    const data = (await response.json()) as OrderApiResponse;
    return data.order ?? null;
  }

  async function refreshStatus(id: string) {
    setBusy(true);
    setNotice("Memeriksa status langsung ke Midtrans...");

    try {
      const url = new URL(`/api/orders/${encodeURIComponent(id)}/refresh`, window.location.origin);
      if (accessToken) url.searchParams.set("access_token", accessToken);

      const response = await fetch(url.toString(), {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await response.json()) as OrderApiResponse;

      if (!response.ok || !data.order) {
        setNotice(data.error ?? "Status Midtrans belum dapat diperbarui.");
        return;
      }

      setOrder(data.order);
      setLastChecked(new Date().toLocaleTimeString("id-ID"));
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
        // Continue to the backwards-compatible local preview below.
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

  useEffect(() => {
    if (!order?.expiresAt || order.status !== "pending_payment") {
      setCountdown(calculateCountdown(order?.expiresAt));
      return;
    }

    setCountdown(calculateCountdown(order.expiresAt));
    const timer = window.setInterval(() => {
      const next = calculateCountdown(order.expiresAt);
      setCountdown(next);
      if (next.isExpired) {
        setNotice("Waktu pembayaran habis. Silakan buat pesanan baru.");
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [order?.expiresAt, order?.status]);

  useEffect(() => {
    if (!order || !["pending_payment", "paid", "processing"].includes(order.status)) return;

    const timer = window.setInterval(() => {
      void loadLiveOrder(order.id).then((fresh) => {
        if (!fresh) return;
        setOrder(fresh);
        setLastChecked(new Date().toLocaleTimeString("id-ID"));
      });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [order?.id, order?.status, accessToken]);

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
      setNotice("Pembayaran Midtrans siap digunakan.");
    } catch {
      embeddedOrderRef.current = null;
      setNotice("Embedded Midtrans belum dapat dimuat. Muat ulang halaman atau gunakan pembayaran cadangan.");
    }
  }, [order?.id, order?.status, order?.payment.snapToken, snapReady, accessToken]);

  async function copyOrderId() {
    const id = order?.id ?? preview?.id ?? "";
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setNotice("Order ID disalin.");
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

  function focusPayment() {
    const paymentContainer = document.getElementById(SNAP_EMBED_ID);
    if (paymentContainer) {
      paymentContainer.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    openFallbackPayment();
  }

  async function createSandboxOrder() {
    if (!preview) return;
    setBusy(true);
    setNotice("");

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
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

      const data = (await response.json()) as OrderApiResponse;
      if (!response.ok || !data.order) {
        setNotice(data.error ?? "Gagal membuat pembayaran Midtrans Sandbox.");
        return;
      }

      window.localStorage.removeItem(previewOrderStorageKey(preview.id));
      setPreview(null);
      setOrder(data.order);
      setAccessToken(data.accessToken ?? null);

      const tokenParam = data.accessToken
        ? `?access_token=${encodeURIComponent(data.accessToken)}`
        : "";
      router.replace(`/order/${encodeURIComponent(data.order.id)}${tokenParam}`);
      setNotice("Order Sandbox dibuat. Pembayaran sedang dimuat.");
    } catch {
      setNotice("Tidak dapat menghubungi server pembayaran.");
    } finally {
      setBusy(false);
    }
  }

  function shareOrder() {
    if (!order || !accessToken) return;
    const url = `${window.location.origin}/order/${encodeURIComponent(order.id)}?access_token=${encodeURIComponent(accessToken)}`;

    if (navigator.share) {
      void navigator.share({ title: "Order Nambah", text: `Order ${order.id}`, url });
      return;
    }

    void navigator.clipboard.writeText(url).then(() => {
      setNotice("Link status disalin.");
    });
  }

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
            <span className="eyebrow">{accessDenied ? "AKSES PESANAN DITOLAK" : "PESANAN TIDAK DITEMUKAN"}</span>
            <h1>{accessDenied ? "Link order tidak memiliki akses." : "Order ini tidak tersedia."}</h1>
            <p>
              {accessDenied
                ? "Gunakan link order yang dibuat saat checkout. Order baru juga menyimpan akses aman di browser ini."
                : "Buat pesanan baru dari halaman utama untuk melanjutkan ke Midtrans Sandbox."}
            </p>
            <Link className="primary-button" href="/#topup">Buat pesanan baru <span>→</span></Link>
          </div>
        </section>
      </main>
    );
  }

  const isPreview = Boolean(preview);
  const product = preview?.product ?? order!.product;
  const account = preview?.account ?? order!.account;
  const payment = preview?.payment ?? order!.payment;
  const pricing = preview?.pricing ?? order!.pricing;
  const promoCode = preview?.promoCode ?? order?.promoCode;
  const referralCode = preview?.referralCode ?? order?.referralCode;
  const displayId = preview?.id ?? order!.id;
  const createdAt = preview?.createdAt ?? order!.createdAt;
  const liveStatus = order?.status ?? "pending_payment";
  const timelineIndex = isPreview
    ? 0
    : Math.max(0, TIMELINE_STEPS.findIndex((step) => step.status === liveStatus));
  const statusActions = isPreview
    ? []
    : STATUS_CTA[liveStatus].filter((cta) => cta.action !== "copy");

  const paymentType = order?.payment.paymentType ?? null;
  const redirectUrl = order?.payment.redirectUrl ?? null;

  return (
    <main>
      {midtransClientKey && order && (
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
            <span className="eyebrow">{isPreview ? "Checkout preview" : "Status pesanan"}</span>
            <h1>{isPreview ? "Siap membuat pembayaran." : STATUS_LABEL[liveStatus]}</h1>
            <p>
              {isPreview
                ? "Harga akan divalidasi ulang di server sebelum order dan token pembayaran dibuat."
                : STATUS_DESCRIPTION[liveStatus]}
            </p>
            {!isPreview && (
              <div className="order-status-meta">
                {liveStatus === "pending_payment" && countdown.totalSeconds > 0 && !countdown.isExpired && (
                  <span className="order-countdown">Sisa waktu {countdown.display}</span>
                )}
                {countdown.isExpired && <span className="order-countdown expired">Waktu habis</span>}
                {lastChecked && <span className="order-last-checked">Diperiksa {lastChecked}</span>}
              </div>
            )}
          </div>
          <span className="order-mode-badge">{isPreview ? "PREVIEW" : "SANDBOX"}</span>
        </div>

        <div className="order-status-grid">
          <article className="order-main-card">
            <div className="order-main-head">
              <div className="order-product-identity">
                <span className="order-product-mark" style={{ background: product.accent }}>
                  {product.initials}
                </span>
                <div>
                  <small>{product.shortName}</small>
                  <strong>{product.packageLabel}</strong>
                </div>
              </div>
              <span className="order-status-pill">
                {isPreview ? "Belum dibuat" : STATUS_LABEL[liveStatus]}
              </span>
            </div>

            <div className="order-id-row">
              <div className="order-id-primary">
                <small>Order ID</small>
                <div className="order-id-copy-line">
                  <strong>{displayId}</strong>
                  <button className="copy-order-id-button" type="button" onClick={() => void copyOrderId()}>
                    Salin
                  </button>
                </div>
              </div>
              <div>
                <small>Dibuat</small>
                <strong>{formatOrderTime(createdAt)}</strong>
              </div>
              {order?.statusChangedAt && liveStatus !== "pending_payment" && (
                <div>
                  <small>Status diubah</small>
                  <strong>{formatOrderTime(order.statusChangedAt)}</strong>
                </div>
              )}
            </div>

            <div className="order-timeline">
              {TIMELINE_STEPS.map((item, index) => (
                <div
                  className={`order-timeline-item ${index <= timelineIndex ? "current" : "upcoming"}`}
                  key={item.title}
                >
                  <div className="timeline-marker"><span>{String(index + 1).padStart(2, "0")}</span></div>
                  <div><strong>{item.title}</strong><p>{item.description}</p></div>
                </div>
              ))}
            </div>

            {isPreview ? (
              <div className="order-payment-preview">
                <div>
                  <small>Metode pembayaran</small>
                  <strong>{payment.name}</strong>
                  <p>{payment.detail}</p>
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
                    <strong>{payment.name}</strong>
                    <p>{payment.detail}</p>
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
                  <span>Pembayaran diverifikasi langsung oleh server Nambah.</span>
                  {(!midtransClientKey || !snapReady) && redirectUrl && (
                    <button type="button" onClick={openFallbackPayment}>Buka pembayaran cadangan</button>
                  )}
                </div>
              </div>
            ) : (
              <div className="order-payment-preview">
                <div>
                  <small>Metode pembayaran</small>
                  <strong>{payment.name}</strong>
                  <p>{payment.detail}</p>
                </div>
                <button type="button" disabled>{STATUS_LABEL[liveStatus]}</button>
              </div>
            )}

            {notice && <p className="order-preview-note">{notice}</p>}
          </article>

          <aside className="order-summary-card">
            <div className="order-summary-head">
              <div>
                <span>Ringkasan pesanan</span>
                <small>{displayId}</small>
              </div>
              <small>{isPreview ? "Preview" : "Sandbox"}</small>
            </div>

            <dl className="order-detail-list">
              <div><dt>Produk</dt><dd>{product.gameName}</dd></div>
              <div><dt>Nominal</dt><dd>{product.packageLabel}</dd></div>
              <div><dt>User ID</dt><dd>{account.userId}</dd></div>
              {account.serverId && <div><dt>Server / Zone</dt><dd>{account.serverId}</dd></div>}
              {promoCode && <div><dt>Promo</dt><dd>{promoCode}</dd></div>}
              {referralCode && <div><dt>Referral</dt><dd>{referralCode}</dd></div>}
              {paymentType && <div><dt>Channel</dt><dd>{paymentType}</dd></div>}
            </dl>

            <div className="order-price-breakdown">
              <div><span>Harga</span><strong>{formatIDR(pricing.sellingPrice)}</strong></div>
              {pricing.promotionDiscount > 0 && (
                <div className="saving"><span>Promo</span><strong>-{formatIDR(pricing.promotionDiscount)}</strong></div>
              )}
              {pricing.referralDiscount > 0 && (
                <div className="referral-saving"><span>Referral</span><strong>-{formatIDR(pricing.referralDiscount)}</strong></div>
              )}
              <div><span>Biaya pembayaran</span><strong>{formatIDR(pricing.customerPaymentFee)}</strong></div>
            </div>

            <div className="order-grand-total">
              <span>Total pembayaran</span>
              <strong>{formatIDR(pricing.finalPrice)}</strong>
            </div>

            {!isPreview && statusActions.length > 0 && (
              <div className="order-summary-actions">
                {statusActions.map((cta, index) => (
                  <button
                    key={`${cta.action}-${cta.label}`}
                    className={`order-action-button ${index === 0 ? "primary" : "secondary"}`}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (cta.action === "pay") focusPayment();
                      if (cta.action === "refresh" && order) void refreshStatus(order.id);
                      if (cta.action === "new_order") router.push("/#topup");
                      if (cta.action === "support") window.open("mailto:support@nambah.com?subject=Order%20Inquiry");
                    }}
                  >
                    {busy && cta.action === "refresh" ? "Memeriksa..." : cta.label}
                  </button>
                ))}
              </div>
            )}

            <div className="order-secondary-links">
              <button className="order-secondary-link" type="button" onClick={() => void copyOrderId()}>
                Salin Order ID
              </button>
              <Link className="order-secondary-link" href="/#topup">Pesanan baru</Link>
              {order && accessToken && (
                <button className="order-secondary-link" type="button" onClick={shareOrder}>
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
