"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";
import {
  previewOrderStorageKey,
  type PreviewOrder,
} from "@/lib/order-preview";

function formatOrderTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function OrderStatusView({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<PreviewOrder | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(previewOrderStorageKey(orderId));
      if (!raw) {
        setOrder(null);
        return;
      }

      const parsed = JSON.parse(raw) as PreviewOrder;
      if (parsed.id !== orderId || parsed.mode !== "preview") {
        setOrder(null);
        return;
      }

      setOrder(parsed);
    } catch {
      setOrder(null);
    }
  }, [orderId]);

  const timeline = useMemo(
    () => [
      {
        title: "Menunggu pembayaran",
        description: "Pesanan sudah terbentuk dan siap diteruskan ke Midtrans.",
        state: "current",
      },
      {
        title: "Pembayaran berhasil",
        description: "Status ini nanti berubah otomatis dari webhook Midtrans.",
        state: "upcoming",
      },
      {
        title: "Sedang diproses",
        description: "Nambah mengirim transaksi ke supplier setelah pembayaran valid.",
        state: "upcoming",
      },
      {
        title: "Top up berhasil",
        description: "Supplier mengonfirmasi transaksi selesai.",
        state: "upcoming",
      },
    ],
    [],
  );

  if (order === undefined) {
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

  if (!order) {
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
            <h1>Preview ini tidak tersedia.</h1>
            <p>
              Data preview disimpan lokal di browser. Buat pesanan baru untuk melihat alur status checkout.
            </p>
            <Link className="primary-button" href="/#topup">Buat pesanan baru <span>→</span></Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
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
            <span className="eyebrow">Order preview</span>
            <h1>Pesanan sudah dibuat.</h1>
            <p>
              Flow customer sudah sampai halaman status. Belum ada pembayaran atau top up asli pada fase ini.
            </p>
          </div>
          <span className="order-mode-badge">PREVIEW · NO CHARGE</span>
        </div>

        <div className="order-status-grid">
          <article className="order-main-card">
            <div className="order-main-head">
              <div className="order-product-identity">
                <span className="order-product-mark" style={{ background: order.product.accent }}>
                  {order.product.initials}
                </span>
                <div>
                  <small>{order.product.shortName}</small>
                  <strong>{order.product.packageLabel}</strong>
                </div>
              </div>
              <span className="order-status-pill">Menunggu pembayaran</span>
            </div>

            <div className="order-id-row">
              <div>
                <small>Order ID</small>
                <strong>{order.id}</strong>
              </div>
              <div>
                <small>Dibuat</small>
                <strong>{formatOrderTime(order.createdAt)}</strong>
              </div>
            </div>

            <div className="order-timeline">
              {timeline.map((item, index) => (
                <div className={`order-timeline-item ${item.state}`} key={item.title}>
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
                <strong>{order.payment.name}</strong>
                <p>{order.payment.detail}</p>
              </div>
              <button disabled type="button">Pembayaran belum aktif</button>
            </div>

            <p className="order-preview-note">
              Midtrans Sandbox akan dipasang pada milestone payment. Saat itu status halaman ini akan berubah dari webhook, bukan simulasi di browser.
            </p>
          </article>

          <aside className="order-summary-card">
            <div className="order-summary-head">
              <span>Ringkasan</span>
              <small>Customer view</small>
            </div>

            <dl className="order-detail-list">
              <div>
                <dt>Produk</dt>
                <dd>{order.product.gameName}</dd>
              </div>
              <div>
                <dt>Nominal</dt>
                <dd>{order.product.packageLabel}</dd>
              </div>
              <div>
                <dt>User ID</dt>
                <dd>{order.account.userId}</dd>
              </div>
              {order.account.serverId && (
                <div>
                  <dt>Server / Zone</dt>
                  <dd>{order.account.serverId}</dd>
                </div>
              )}
              {order.promoCode && (
                <div>
                  <dt>Promo</dt>
                  <dd>{order.promoCode}</dd>
                </div>
              )}
              {order.referralCode && (
                <div>
                  <dt>Referral</dt>
                  <dd>{order.referralCode}</dd>
                </div>
              )}
            </dl>

            <div className="order-price-breakdown">
              <div>
                <span>Harga Nambah</span>
                <strong>{formatIDR(order.pricing.sellingPrice)}</strong>
              </div>
              {order.pricing.promotionDiscount > 0 && (
                <div className="saving">
                  <span>Promo {order.pricing.promoCode}</span>
                  <strong>-{formatIDR(order.pricing.promotionDiscount)}</strong>
                </div>
              )}
              {order.pricing.referralDiscount > 0 && (
                <div className="referral-saving">
                  <span>Benefit referral</span>
                  <strong>-{formatIDR(order.pricing.referralDiscount)}</strong>
                </div>
              )}
              <div>
                <span>Biaya pembayaran</span>
                <strong>{formatIDR(order.pricing.customerPaymentFee)}</strong>
              </div>
            </div>

            <div className="order-grand-total">
              <span>Total</span>
              <strong>{formatIDR(order.pricing.finalPrice)}</strong>
            </div>

            <div className="order-summary-actions">
              <Link className="primary-button full" href="/#topup">Buat pesanan lain <span>→</span></Link>
              <Link className="order-secondary-link" href="/">Kembali ke beranda</Link>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
