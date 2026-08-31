"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicOrder } from "@/lib/order-public";
import {
  previewOrderStorageKey,
  type PreviewOrder,
} from "@/lib/order-preview";
import { formatIDR } from "@/lib/pricing";

type SnapCallbacks = {
  onSuccess?: (result: unknown) => void;
  onPending?: (result: unknown) => void;
  onError?: (result: unknown) => void;
  onClose?: () => void;
  language?: "id" | "en";
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

function statusLabel(status: PublicOrder["status"]) {
  switch (status) {
    case "paid":
      return "Pembayaran berhasil";
    case "processing":
      return "Sedang diproses";
    case "success":
      return "Top up berhasil";
    case "failed":
      return "Pesanan gagal";
    case "refunded":
      return "Dana dikembalikan";
    case "cancelled":
      return "Pembayaran dibatalkan";
    default:
      return "Menunggu pembayaran";
  }
}

function timelineIndex(status: PublicOrder["status"]) {
  if (status === "success") return 3;
  if (status === "processing") return 2;
  if (status === "paid") return 1;
  return 0;
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

  async function loadLiveOrder(id: string) {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { order?: PublicOrder };
    return data.order ?? null;
  }

  async function refreshStatus(id: string) {
    setBusy(true);
    setNotice("Memeriksa status langsung ke Midtrans...");

    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}/refresh`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; order?: PublicOrder };

      if (!response.ok || !data.order) {
        setNotice(data.error ?? "Status Midtrans belum dapat diperbarui.");
        return;
      }

      setOrder(data.order);
      setNotice(`Status diperbarui: ${statusLabel(data.order.status)}.`);
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

  useEffect(() => {
    if (!order || order.status !== "pending_payment") return;

    const timer = window.setInterval(() => {
      void loadLiveOrder(order.id).then((fresh) => {
        if (fresh) setOrder(fresh);
      });
    }, 4_000);

    return () => window.clearInterval(timer);
  }, [order?.id, order?.status]);

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

  const timeline = useMemo(
    () => [
      {
        title: "Menunggu pembayaran",
        description: "Pembayaran Midtrans tampil langsung di halaman Nambah.",
      },
      {
        title: "Pembayaran berhasil",
        description: "Status hanya berubah setelah backend memverifikasi Midtrans.",
      },
      {
        title: "Sedang diproses",
        description: "Eksekusi supplier production belum diaktifkan pada milestone ini.",
      },
      {
        title: "Top up berhasil",
        description: "Tahap ini akan aktif setelah order orchestration Digiflazz berikutnya.",
      },
    ],
    [],
  );

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
      router.replace(`/order/${encodeURIComponent(data.order.id)}`);
      setNotice("Order Sandbox dibuat. Pembayaran akan dimuat di halaman ini.");
    } catch {
      setNotice("Tidak dapat menghubungi server pembayaran.");
    } finally {
      setBusy(false);
    }
  }

  function openFallbackPayment() {
    if (order?.payment.redirectUrl) {
      window.open(order.payment.redirectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setNotice("URL pembayaran cadangan belum tersedia.");
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
            <span className="eyebrow">Pesanan tidak ditemukan</span>
            <h1>Order ini tidak tersedia.</h1>
            <p>Buat pesanan baru dari halaman utama untuk melanjutkan ke Midtrans Sandbox.</p>
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
  const createdAt = preview?.createdAt ?? order!.createdAt;
  const displayId = preview?.id ?? order!.id;
  const liveStatus = order?.status ?? "pending_payment";
  const reachedIndex = isPreview ? 0 : timelineIndex(liveStatus);

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
            <span className="eyebrow">{isPreview ? "Checkout preview" : "Midtrans Embedded"}</span>
            <h1>{isPreview ? "Siap membuat pembayaran." : statusLabel(liveStatus)}</h1>
            <p>
              {isPreview
                ? "Harga akan divalidasi ulang di server sebelum order dan token pembayaran dibuat."
                : "Pembayaran berjalan di dalam website Nambah. Status tetap diverifikasi oleh backend melalui Midtrans."}
            </p>
          </div>
          <span className="order-mode-badge">
            {isPreview ? "PREVIEW" : "SANDBOX · EMBEDDED"}
          </span>
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
                {isPreview ? "Belum dibuat" : statusLabel(liveStatus)}
              </span>
            </div>

            <div className="order-id-row">
              <div>
                <small>Order ID</small>
                <strong>{displayId}</strong>
              </div>
              <div>
                <small>Dibuat</small>
                <strong>{formatOrderTime(createdAt)}</strong>
              </div>
            </div>

            <div className="order-timeline">
              {timeline.map((item, index) => (
                <div
                  className={`order-timeline-item ${index <= reachedIndex ? "current" : "upcoming"}`}
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
            ) : order!.status === "pending_payment" ? (
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
                  <span>Pembayaran tetap diverifikasi server-side.</span>
                  {(!midtransClientKey || !snapReady) && order!.payment.redirectUrl && (
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
                <button type="button" disabled>{statusLabel(liveStatus)}</button>
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
              <div><dt>Produk</dt><dd>{product.gameName}</dd></div>
              <div><dt>Nominal</dt><dd>{product.packageLabel}</dd></div>
              <div><dt>User ID</dt><dd>{account.userId}</dd></div>
              {account.serverId && <div><dt>Server / Zone</dt><dd>{account.serverId}</dd></div>}
              {promoCode && <div><dt>Promo</dt><dd>{promoCode}</dd></div>}
              {referralCode && <div><dt>Referral</dt><dd>{referralCode}</dd></div>}
              {order?.payment.paymentType && <div><dt>Channel Midtrans</dt><dd>{order.payment.paymentType}</dd></div>}
            </dl>

            <div className="order-price-breakdown">
              <div><span>Harga Nambah</span><strong>{formatIDR(pricing.sellingPrice)}</strong></div>
              {pricing.promotionDiscount > 0 && <div className="saving"><span>Promo</span><strong>-{formatIDR(pricing.promotionDiscount)}</strong></div>}
              {pricing.referralDiscount > 0 && <div className="referral-saving"><span>Benefit referral</span><strong>-{formatIDR(pricing.referralDiscount)}</strong></div>}
              <div><span>Biaya pembayaran</span><strong>{formatIDR(pricing.customerPaymentFee)}</strong></div>
            </div>

            <div className="order-grand-total">
              <span>Total</span>
              <strong>{formatIDR(pricing.finalPrice)}</strong>
            </div>

            <div className="order-summary-actions">
              {order && order.status === "pending_payment" && (
                <button className="primary-button full" type="button" disabled={busy} onClick={() => void refreshStatus(order.id)}>
                  Cek status Midtrans <span>↻</span>
                </button>
              )}
              <Link className="order-secondary-link" href="/#topup">Buat pesanan lain</Link>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
