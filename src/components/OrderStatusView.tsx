"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PublicOrder } from "@/lib/order-public";
import {
  previewOrderStorageKey,
  type PreviewOrder,
} from "@/lib/order-preview";
import { formatIDR } from "@/lib/pricing";

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        options: {
          onSuccess?: (result: unknown) => void;
          onPending?: (result: unknown) => void;
          onError?: (result: unknown) => void;
          onClose?: () => void;
          language?: "id" | "en";
        },
      ) => void;
    };
  }
}

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
  const midtransClientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY?.trim() ?? "";

  async function loadLiveOrder(id: string) {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { order?: PublicOrder };
    return data.order ?? null;
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
        // Fall back to a browser preview below.
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
  }, [order]);

  const timeline = useMemo(
    () => [
      {
        title: "Menunggu pembayaran",
        description: "Order terbentuk dan menunggu pembayaran melalui Midtrans Sandbox.",
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
      setNotice("Order Sandbox dibuat. Klik Bayar sekarang untuk membuka Midtrans.");
    } catch {
      setNotice("Tidak dapat menghubungi server pembayaran.");
    } finally {
      setBusy(false);
    }
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

  function startPayment() {
    if (!order || order.status !== "pending_payment") return;
    setNotice("");

    if (snapReady && window.snap && order.payment.snapToken) {
      window.snap.pay(order.payment.snapToken, {
        language: "id",
        onSuccess: () => {
          setNotice("Pembayaran selesai. Memverifikasi ke Midtrans...");
          void refreshStatus(order.id);
        },
        onPending: () => {
          setNotice("Pembayaran masih pending. Memverifikasi status...");
          void refreshStatus(order.id);
        },
        onError: () => {
          setNotice("Percobaan pembayaran gagal. Kamu masih bisa mencoba kembali.");
          void refreshStatus(order.id);
        },
        onClose: () => {
          setNotice("Jendela pembayaran ditutup. Order masih dapat dibayar selama Snap belum kedaluwarsa.");
        },
      });
      return;
    }

    if (order.payment.redirectUrl) {
      window.location.assign(order.payment.redirectUrl);
      return;
    }

    setNotice("Snap Midtrans belum siap. Coba muat ulang halaman.");
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
  const paymentActionEnabled = isPreview || liveStatus === "pending_payment";

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
            <span className="eyebrow">{isPreview ? "Checkout preview" : "Midtrans Sandbox"}</span>
            <h1>{isPreview ? "Siap membuat pembayaran." : statusLabel(liveStatus)}</h1>
            <p>
              {isPreview
                ? "Harga akan divalidasi ulang di server sebelum order dan Snap token dibuat."
                : "Status pembayaran berasal dari webhook Midtrans atau Get Status API, bukan callback browser."}
            </p>
          </div>
          <span className="order-mode-badge">
            {isPreview ? "PREVIEW" : "SANDBOX · NO REAL CHARGE"}
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

            <div className="order-payment-preview">
              <div>
                <small>Metode pembayaran</small>
                <strong>{payment.name}</strong>
                <p>{payment.detail}</p>
              </div>
              <button
                type="button"
                disabled={busy || !paymentActionEnabled}
                onClick={() => {
                  if (isPreview) void createSandboxOrder();
                  else startPayment();
                }}
                style={
                  paymentActionEnabled && !busy
                    ? {
                        cursor: "pointer",
                        background: "var(--lime)",
                        color: "#111",
                        borderColor: "transparent",
                      }
                    : undefined
                }
              >
                {busy
                  ? "Memproses..."
                  : isPreview
                    ? "Buat pembayaran Sandbox"
                    : liveStatus === "pending_payment"
                      ? "Bayar sekarang"
                      : statusLabel(liveStatus)}
              </button>
            </div>

            {order && order.status === "pending_payment" && (
              <p className="order-preview-note">
                Snap akan terbuka di halaman ini jika Client Key tersedia. Jika tidak, Nambah memakai redirect URL Sandbox. Setelah membayar, status diverifikasi ulang dari backend.
              </p>
            )}

            {notice && <p className="order-preview-note">{notice}</p>}
          </article>

          <aside className="order-summary-card">
            <div className="order-summary-head">
              <span>Ringkasan</span>
              <small>{isPreview ? "Preview" : "Sandbox"}</small>
            </div>

            <dl className="order-detail-list">
              <div>
                <dt>Produk</dt>
                <dd>{product.gameName}</dd>
              </div>
              <div>
                <dt>Nominal</dt>
                <dd>{product.packageLabel}</dd>
              </div>
              <div>
                <dt>User ID</dt>
                <dd>{account.userId}</dd>
              </div>
              {account.serverId && (
                <div>
                  <dt>Server / Zone</dt>
                  <dd>{account.serverId}</dd>
                </div>
              )}
              {promoCode && (
                <div>
                  <dt>Promo</dt>
                  <dd>{promoCode}</dd>
                </div>
              )}
              {referralCode && (
                <div>
                  <dt>Referral</dt>
                  <dd>{referralCode}</dd>
                </div>
              )}
              {order?.payment.paymentType && (
                <div>
                  <dt>Channel Midtrans</dt>
                  <dd>{order.payment.paymentType}</dd>
                </div>
              )}
            </dl>

            <div className="order-price-breakdown">
              <div>
                <span>Harga Nambah</span>
                <strong>{formatIDR(pricing.sellingPrice)}</strong>
              </div>
              {pricing.promotionDiscount > 0 && (
                <div className="saving">
                  <span>Promo</span>
                  <strong>-{formatIDR(pricing.promotionDiscount)}</strong>
                </div>
              )}
              {pricing.referralDiscount > 0 && (
                <div className="referral-saving">
                  <span>Benefit referral</span>
                  <strong>-{formatIDR(pricing.referralDiscount)}</strong>
                </div>
              )}
              <div>
                <span>Biaya pembayaran</span>
                <strong>{formatIDR(pricing.customerPaymentFee)}</strong>
              </div>
            </div>

            <div className="order-grand-total">
              <span>Total</span>
              <strong>{formatIDR(pricing.finalPrice)}</strong>
            </div>

            <div className="order-summary-actions">
              {order && order.status === "pending_payment" && (
                <button
                  className="primary-button full"
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshStatus(order.id)}
                >
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
