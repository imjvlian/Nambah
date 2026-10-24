"use client";

import Link from "next/link";
import AccountNav from "@/components/AccountNav";
import SiteHeader from "@/components/SiteHeader";
import BrandLogo from "@/components/BrandLogo";
import DokuQrisPanel, { DOKU_QRIS_PANEL_ID } from "@/components/DokuQrisPanel";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PublicOrder } from "@/lib/order-public";
import { previewOrderStorageKey, type PreviewOrder } from "@/lib/order-preview";
import { paymentTypeLabel } from "@/lib/payment-label";
import { formatIDR } from "@/lib/pricing";
import OrderRatingForm from "@/components/OrderRatingForm";
import OrderSummaryAdSlot from "@/components/OrderSummaryAdSlot";
import {
  MERCHANT_TIMELINE_STEPS,
  STATUS_CTA,
  STATUS_DESCRIPTION,
  STATUS_LABEL,
  TIMELINE_STEPS,
  calculateCountdown,
} from "@/lib/order-status";
import {
  retryCTALabel,
  stowRetryPrefill,
} from "@/lib/order-retry";
import type { PublicOrderStatus } from "@/lib/order-public";
import { MERCHANT_RETAIL_PAYMENT_METHOD_ID } from "@/lib/catalog";
import MerchantScanCode from "@/components/MerchantScanCode";

import { BRAND } from "@/lib/brand";

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
    /** Jokul Checkout JS — modal pembayaran DOKU di halaman merchant. */
    loadJokulCheckout?: (paymentUrl: string) => void;
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
  const [preview, setPreview] = useState<PreviewOrder | null | undefined>(
    undefined,
  );
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapReady, setSnapReady] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [countdown, setCountdown] = useState(() => calculateCountdown(null));
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const embeddedOrderRef = useRef<string | null>(null);
  const dokuPopupRef = useRef<Window | null>(null);
  const dokuPopupTimerRef = useRef<number | null>(null);
  const midtransClientKey =
    process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY?.trim() ?? "";
  const configuredMidtransEnvironment =
    process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT?.trim().toLowerCase() ===
    "production"
      ? "production"
      : "sandbox";
  const midtransEnvironment =
    order?.mode === "midtrans-production"
      ? "production"
      : order?.mode === "midtrans-sandbox"
        ? "sandbox"
        : configuredMidtransEnvironment;
  const midtransLabel =
    midtransEnvironment === "production" ? "Midtrans" : "Midtrans Sandbox";
  const midtransSnapUrl =
    midtransEnvironment === "production"
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js";

  async function loadLiveOrder(id: string, token = accessToken) {
    const url = new URL(
      `/api/orders/${encodeURIComponent(id)}`,
      window.location.origin,
    );
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
    setNotice("Memeriksa status pembayaran...");

    try {
      const url = new URL(
        `/api/orders/${encodeURIComponent(id)}/refresh`,
        window.location.origin,
      );
      if (accessToken) url.searchParams.set("access_token", accessToken);

      const response = await fetch(url.toString(), {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await response.json()) as OrderApiResponse;

      if (!response.ok || !data.order) {
        setNotice(
          data.error ??
            "Statusnya belum berhasil di-update. Coba beberapa saat lagi.",
        );
        return;
      }

      setOrder(data.order);
      setLastChecked(new Date().toLocaleTimeString("id-ID"));
      setNotice(`Status diperbarui: ${STATUS_LABEL[data.order.status]}.`);
    } catch {
      setNotice("Sistemnya lagi sibuk — status belum bisa dicek.");
    } finally {
      setBusy(false);
    }
  }

  function snapCallbacks(id: string): SnapCallbacks {
    return {
      language: "id",
      onSuccess: () => {
        setNotice(
          `Pembayaran selesai. ${BRAND.shortName} lagi cek pembayaranmu…`,
        );
        void refreshStatus(id);
      },
      onPending: () => {
        setNotice(
          `Pembayaran masih pending. ${BRAND.shortName} lagi cek statusnya…`,
        );
        void refreshStatus(id);
      },
      onError: () => {
        setNotice("Percobaan pembayaran gagal. Status akan diperiksa ulang.");
        void refreshStatus(id);
      },
      onClose: () => {
        setNotice(
          "Jendela bayarnya ditutup. Tenang, ordernya masih bisa dibayar sebelum waktunya habis.",
        );
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
        const raw = window.localStorage.getItem(
          previewOrderStorageKey(orderId),
        );
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

  /*
   * Status yang perlu dipantau otomatis.
   *
   * `pending_merchant` WAJIB ada di sini. Order ritel tidak punya webhook
   * gateway yang mendorong perubahan status — satu-satunya jalan dari
   * "menunggu konfirmasi toko" ke "diproses" adalah kasir yang scan. Tanpa
   * polling, customer akan melihat status membeku di layar yang sama
   * padahal top up sudah selesai beberapa detik lalu.
   */
  const livePolledStatuses: PublicOrderStatus[] = [
    "pending_payment",
    "pending_merchant",
    "paid",
    "processing",
  ];

  useEffect(() => {
    if (!order || !livePolledStatuses.includes(order.status)) return;

    const timer = window.setInterval(() => {
      void loadLiveOrder(order.id).then((fresh) => {
        if (!fresh) return;
        setOrder(fresh);
        setLastChecked(new Date().toLocaleTimeString("id-ID"));
      });
    }, 5000);

    return () => window.clearInterval(timer);
    // `livePolledStatuses` dibuat baru tiap render, jadi memakainya sebagai
    // dependensi akan me-reset interval tiap tick. Yang dipantau hanyalah
    // status order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setNotice("Pembayaran siap digunakan.");
    } catch {
      embeddedOrderRef.current = null;
      setNotice(
        "Pembayaran belum dapat dimuat. Muat ulang halaman atau gunakan pembayaran cadangan.",
      );
    }
  }, [
    order?.id,
    order?.status,
    order?.payment.snapToken,
    snapReady,
    accessToken,
  ]);

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

  async function copySerialNumber() {
    const sn = order?.serialNumber ?? "";
    if (!sn) return;
    try {
      await navigator.clipboard.writeText(sn);
      setNotice("Serial number disalin.");
    } catch {
      setNotice("Gagal menyalin serial number.");
    }
  }

  function openFallbackPayment() {
    if (order?.payment.redirectUrl) {
      window.open(order.payment.redirectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setNotice("URL pembayaran cadangan belum tersedia.");
  }

  // Popup window terpusat (bukan tab penuh): jendela kecil memuat halaman
  // pembayaran DOKU langsung — bebas dari blokir iframe karena tidak memakai
  // bingkai. Saat jendela ditutup, status order otomatis diperbarui.
  function openDokuPopup(url: string, forOrderId: string) {
    const width = 520;
    const height = 780;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    const popup = window.open(
      url,
      "doku_payment",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );

    if (!popup) return false;

    setCheckoutModalOpen(false);
    dokuPopupRef.current = popup;
    if (dokuPopupTimerRef.current) {
      window.clearInterval(dokuPopupTimerRef.current);
    }
    dokuPopupTimerRef.current = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(dokuPopupTimerRef.current!);
        dokuPopupTimerRef.current = null;
        dokuPopupRef.current = null;
        setNotice("Jendela pembayaran ditutup — memeriksa status terbaru...");
        void refreshStatus(forOrderId);
      }
    }, 1500);
    return true;
  }

  function openDokuCheckout() {
    const url = order?.payment.redirectUrl;
    if (!url || !order) {
      setNotice("Sesi pembayaran DOKU belum tersedia.");
      return;
    }
    // Popup diblokir browser → panel CTA tampil sebagai fallback terakhir.
    if (!openDokuPopup(url, order.id)) {
      setCheckoutModalOpen(true);
    }
  }

  useEffect(() => {
    return () => {
      if (dokuPopupTimerRef.current) {
        window.clearInterval(dokuPopupTimerRef.current);
      }
    };
  }, []);

  function focusPayment() {
    // Order DOKU mode checkout: buka modal Jokul, bukan tab baru.
    if (
      order?.payment.provider === "doku" &&
      !order.doku?.qrContent &&
      order.payment.redirectUrl
    ) {
      openDokuCheckout();
      return;
    }
    const dokuContainer = document.getElementById(DOKU_QRIS_PANEL_ID);
    if (dokuContainer) {
      dokuContainer.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const paymentContainer = document.getElementById(SNAP_EMBED_ID);
    if (paymentContainer) {
      paymentContainer.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    openFallbackPayment();
  }

  async function createPaymentOrder() {
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
        setNotice(data.error ?? "Gagal membuat pembayaran.");
        return;
      }

      window.localStorage.removeItem(previewOrderStorageKey(preview.id));
      setPreview(null);
      setOrder(data.order);
      setAccessToken(data.accessToken ?? null);

      const tokenParam = data.accessToken
        ? `?access_token=${encodeURIComponent(data.accessToken)}`
        : "";
      router.replace(
        `/order/${encodeURIComponent(data.order.id)}${tokenParam}`,
      );

      // Popup langsung dibuka dari gesture klik "Buat pesanan" (masih dalam
      // jendela transient activation Chrome) — tanpa halaman perantara.
      if (
        data.order.payment.provider === "doku" &&
        data.order.payment.redirectUrl
      ) {
        openDokuPopup(data.order.payment.redirectUrl, data.order.id);
      }
      setNotice("Order dibuat. Sebentar, pembayarannya kita siapkan.");
    } catch {
      setNotice("Jaringannya lagi ngaco. Coba lagi sebentar ya.");
    } finally {
      setBusy(false);
    }
  }

  function shareOrder() {
    if (!order || !accessToken) return;
    const url = `${window.location.origin}/order/${encodeURIComponent(order.id)}?access_token=${encodeURIComponent(accessToken)}`;

    if (navigator.share) {
      void navigator.share({
        title: `Order ${BRAND.shortName}`,
        text: `Order ${order.id}`,
        url,
      });
      return;
    }

    void navigator.clipboard.writeText(url).then(() => {
      setNotice("Link status disalin.");
    });
  }

  async function submitRefundRequest() {
    if (!order || refundBusy) return;

    const reason = refundReason.trim();
    if (reason.length < 3) {
      setNotice("Ceritakan dulu alasannya, minimal 3 karakter.");
      return;
    }

    setRefundBusy(true);
    setNotice("");

    try {
      const url = new URL(
        `/api/orders/${encodeURIComponent(order.id)}/refund`,
        window.location.origin,
      );
      if (accessToken) url.searchParams.set("access_token", accessToken);

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ reason }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        refund?: PublicOrder["refund"];
      };

      if (!response.ok || !data.refund) {
        setNotice(data.error ?? "Permintaan refund gagal dikirim.");
        return;
      }

      setOrder((current) =>
        current ? { ...current, refund: data.refund ?? null } : current,
      );
      setRefundReason("");
      setNotice(data.message ?? "Permintaan refund kamu sudah kami terima.");
    } catch {
      setNotice("Permintaan refund belum dapat dikirim. Coba lagi sebentar.");
    } finally {
      setRefundBusy(false);
    }
  }

  /**
   * P3.2: "Coba lagi"/"Top up lagi"/"Buat pesanan baru" — satu perilaku
   * untuk semuanya: bawa data order lama sebagai prefill, lalu ke etalase.
   *
   * Label-nya yang membedakan (lihat retryCTALabel); perilakunya prefill,
   * bukan auto-beli — pelanggan tetap melihat harga terkini dan semua gate
   * jalan seperti biasa. Best-effort: gagal sessionStorage tidak boleh
   * menghalangi navigasi.
   */
  function cobaLagiDenganPrefill() {
    if (order) {
      stowRetryPrefill({
        status: order.status,
        paidAt: order.payment.paidAt,
        product: {
          gameId: order.product.gameId,
          packageId: order.product.packageId,
        },
        account: {
          userId: order.account.userId,
          ...(order.account.serverId
            ? { serverId: order.account.serverId }
            : {}),
        },
        promoCode: order.promoCode ?? null,
        referralCode: order.referralCode ?? null,
      });
    }
    router.push("/#topup");
  }

  if (preview === undefined || order === undefined) {
    return (
      <main>
        <SiteHeader className="order-header">
          <BrandLogo href="/" size="md" variant="horizontal" />
          <div className="header-actions">
            <AccountNav />
          </div>
        </SiteHeader>
        <section className="order-status-shell shell">
          <div className="order-empty-card">Nyari pesananmu…</div>
        </section>
      </main>
    );
  }

  if (!preview && !order) {
    return (
      <main>
        <SiteHeader className="order-header">
          <BrandLogo href="/" size="md" variant="horizontal" />
          <div className="header-actions">
            <AccountNav />
          </div>
        </SiteHeader>
        <section className="order-status-shell shell">
          <div className="order-empty-card">
            <span className="eyebrow">
              {accessDenied ? "LINK TIDAK VALID" : "PESANAN TIDAK DITEMUKAN"}
            </span>
            <h1>
              {accessDenied
                ? "Link pesanan ini tidak bisa dibuka."
                : "Pesanan ini tidak ada atau sudah tidak bisa dibuka."}
            </h1>
            <p>
              {accessDenied
                ? "Buka pesanan lewat link yang kamu dapat setelah checkout — atau cek status pesananmu dengan Order ID."
                : "Buat pesanan baru aja, ya — atau cek status pesananmu dengan Order ID."}
            </p>
            <div className="order-empty-actions">
              <Link className="primary-button" href="/#topup">
                Buat pesanan baru <span>→</span>
              </Link>
              {/* P4.2: jalur pemulihan untuk pelanggan yang kehilangan
                  link ordernya — Order ID + kontak checkout. */}
              <Link className="order-secondary-link" href="/cek-status">
                Cek status dengan Order ID
              </Link>
            </div>
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
  const serialNumber = order?.serialNumber ?? null;
  const displayId = preview?.id ?? order!.id;
  const createdAt = preview?.createdAt ?? order!.createdAt;
  const liveStatus = order?.status ?? "pending_payment";

  /*
   * Timeline mengikuti jalur pembayaran yang dipakai order ini.
   *
   * Menentukan dari payment method, bukan dari status: order ritel dimulai
   * di `pending_merchant`, tapi begitu merchant scan statusnya jadi
   * `processing` / `success` — identik dengan order Midtrans. Kalau
   * pemilihan timeline ikut status, order ritel akan melompat ke timeline
   * generic begitu discan, dan langkah "Transaksi diverifikasi oleh sistem"
   * akan muncul di depan customer yang membayarnya tunai di konter.
   */
  const isMerchantOrder = payment.id === MERCHANT_RETAIL_PAYMENT_METHOD_ID;
  const activeTimeline = isMerchantOrder
    ? MERCHANT_TIMELINE_STEPS
    : TIMELINE_STEPS;

  const timelineIndex = isPreview
    ? 0
    : Math.max(
        0,
        activeTimeline.findIndex((step) => step.status === liveStatus),
      );
  // Countdown sudah lewat tapi status masih `pending_payment`: order baru saja
  // melewati batas, atau cron sweeper belum sempat membatalkannya (jalur
  // paling lama 10 menit, plus 5 menit grace di `order-expiry.ts`).
  //
  // Tanpa penanganan ini tombol "Buka pembayaran" tetap tampil. Customer
  // mengkliknya, membuka halaman Midtrans, lalu ditolak karena Snap-nya sudah
  // kedaluwarsa — dead end. Sembunyikan CTA bayar dan
  // tawarkan pesanan baru, karena itu satu-satunya jalan keluar yang berhasil.
  const paymentWindowClosed =
    liveStatus === "pending_payment" && countdown.isExpired;

  const statusActions = (() => {
    /*
     * P3.2: label tombol "new_order" jadi DINAMIS berdasarkan uang.
     *
     * Satu aksi (prefill + navigasi), tiga label yang memberi tahu
     * pelanggan apa yang akan terjadi: "Coba lagi" untuk order yang
     * tidak pernah mengambil uang, "Top up lagi" untuk pembelian
     * ulang, dan "Buat pesanan baru" untuk failed-yang-sudah-dibayar
     * — di situ uang pelanggan tertahan menunggu refund, dan tombol
     * yang terasa seperti "lanjutkan" berarti menggoda bayar dua kali.
     */
    const withRetryLabel = <T extends { label: string; action: string }>(
      actions: T[],
    ): T[] =>
      order
        ? actions.map((cta) =>
            cta.action === "new_order"
              ? {
                  ...cta,
                  label: paymentWindowClosed
                    ? "Coba lagi"
                    : retryCTALabel({
                        status: liveStatus,
                        paidAt: order.payment.paidAt,
                      }),
                }
              : cta,
          )
        : actions;

    if (isPreview) return [];
    if (paymentWindowClosed) {
      return withRetryLabel([
        { label: "Buat pesanan baru", action: "new_order" },
        { label: "Periksa status", action: "refresh" },
      ]);
    }
    return withRetryLabel(
      STATUS_CTA[liveStatus].filter((cta) => cta.action !== "copy"),
    );
  })();

  const paymentType = order?.payment.paymentType ?? null;
  const paymentChannel = paymentTypeLabel(paymentType);
  const redirectUrl = order?.payment.redirectUrl ?? null;
  const isDoku = order?.payment.provider === "doku";
  const isPaylabs = order?.payment.provider === "paylabs";
  const dokuQrContent = isDoku ? (order?.doku?.qrContent ?? null) : null;
  const paylabsQrContent = isPaylabs
    ? (order?.paylabs?.qrContent ?? null)
    : null;
  const paylabsVaNumber = isPaylabs ? (order?.paylabs?.vaNumber ?? null) : null;

  return (
    <main>
      {midtransClientKey && order && !isDoku && (
        <Script
          id={"midtrans-snap-" + midtransEnvironment}
          src={midtransSnapUrl}
          data-client-key={midtransClientKey}
          strategy="afterInteractive"
          onLoad={() => setSnapReady(true)}
        />
      )}

      {isDoku &&
        !dokuQrContent &&
        checkoutModalOpen &&
        order?.payment.redirectUrl && (
          <div
            className="doku-checkout-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Pembayaran DOKU"
            onClick={() => setCheckoutModalOpen(false)}
          >
            <div
              className="doku-checkout-modal-content"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="doku-checkout-modal-head">
                <strong>Pembayaran</strong>
                <button
                  type="button"
                  aria-label="Tutup jendela pembayaran"
                  onClick={() => setCheckoutModalOpen(false)}
                >
                  ✕
                </button>
              </div>
              {/* Halaman checkout DOKU mengirim CSP frame-ancestors / X-Frame-
                Options yang melarang iframe dari origin mana pun — popup
                window adalah cara menampilkannya tanpa berpindah tab. */}
              <div className="doku-checkout-modal-fallback">
                <strong>Selesaikan pembayaran di jendela popup.</strong>
                <p>
                  Jendela kecil pembayaran akan terbuka di atas halaman ini.
                  Setelah kamu membayar dan menutupnya, status order di sini
                  langsung diperbarui otomatis.
                </p>
                <button
                  type="button"
                  className="order-action-button primary"
                  onClick={openDokuCheckout}
                >
                  Buka jendela pembayaran
                </button>
                <button
                  type="button"
                  className="order-secondary-link"
                  onClick={openFallbackPayment}
                >
                  atau buka di tab baru
                </button>
              </div>
            </div>
          </div>
        )}

      <SiteHeader className="order-header">
        <BrandLogo href="/" size="md" variant="horizontal" />
        <div className="order-header-center">Status pesanan</div>
        <div className="header-actions">
          <AccountNav />
        </div>
      </SiteHeader>

      <section className="order-status-shell shell">
        <div className="order-status-title">
          <div>
            <span className="eyebrow">
              {isPreview ? "Ringkasan pesanan" : "Status pesanan"}
            </span>
            <h1>
              {isPreview
                ? "Siap membuat pembayaran."
                : STATUS_LABEL[liveStatus]}
            </h1>
            <p>
              {isPreview
                ? "Harga sudah disesuaikan dengan promo, referral, dan points yang kamu pakai."
                : paymentWindowClosed
                  ? "Waktu pembayaran untuk pesanan ini sudah habis. Coba lagi - datamu sudah kami siapkan."
                  : liveStatus === "failed" && order?.payment.paidAt
                    ? "Pembayaranmu sudah masuk tapi pengiriman gagal. Ajukan refund di bawah - danamu akan kami kembalikan."
                    : liveStatus === "failed"
                      ? "Pembayaran gagal atau kedaluwarsa. Tenang, kamu bisa langsung coba lagi - datamu sudah kami siapkan."
                      : STATUS_DESCRIPTION[liveStatus]}
            </p>
            {!isPreview && (
              <div className="order-status-meta">
                {liveStatus === "pending_payment" &&
                  countdown.totalSeconds > 0 &&
                  !countdown.isExpired && (
                    <span className="order-countdown">
                      Sisa waktu {countdown.display}
                    </span>
                  )}
                {/* Badge "Waktu habis" hanya relevan selama masih menunggu
                    pembayaran. Tanpa gate status ini, order yang sukses tapi
                    dibuat lebih dari 30 menit lalu tetap akan menampilkan
                    "Waktu habis" karena `countdown.isExpired` true. */}
                {liveStatus === "pending_payment" && countdown.isExpired && (
                  <span className="order-countdown expired">Waktu habis</span>
                )}
                {lastChecked && (
                  <span className="order-last-checked">
                    Diperiksa {lastChecked}
                  </span>
                )}
              </div>
            )}
          </div>
          <span className="order-mode-badge">
            {isPreview ? "Pratinjau" : "Pembayaran"}
          </span>
        </div>

        <div className="order-status-grid">
          <article className="order-main-card">
            <div className="order-main-head">
              <div className="order-product-identity">
                <span
                  className="order-product-mark"
                  style={{ background: product.accent }}
                >
                  {product.initials}
                </span>
                <div>
                  <small>{product.shortName}</small>
                  <strong>{product.packageLabel}</strong>
                </div>
              </div>
              <span className="order-status-pill">
                {isPreview ? "Menunggu pembayaran" : STATUS_LABEL[liveStatus]}
              </span>
            </div>

            {/* QR + kode pindai kasir. Hanya untuk order ritel yang masih
                menunggu scan; kode ditutup setelah kasir memindai. */}
            {order?.merchantScanCode &&
            payment.id === MERCHANT_RETAIL_PAYMENT_METHOD_ID &&
            liveStatus === "pending_merchant" ? (
              <MerchantScanCode
                code={order.merchantScanCode}
                amount={pricing.finalPrice}
              />
            ) : null}

            <div className="order-id-row">
              <div className="order-id-primary">
                <small>Order ID</small>
                <div className="order-id-copy-line">
                  <strong>{displayId}</strong>
                  <button
                    className="copy-order-id-button"
                    type="button"
                    onClick={() => void copyOrderId()}
                  >
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
              {activeTimeline.map((item, index) => (
                <div
                  className={`order-timeline-item ${index <= timelineIndex ? "current" : "upcoming"}`}
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
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void createPaymentOrder()}
                >
                  {busy ? "Memproses..." : "Buat pembayaran"}
                </button>
              </div>
            ) : paymentWindowClosed ? (
              // Snap embed tidak dimuat kalau jendela pembayaran sudah tutup:
              // token-nya kedaluwarsa di sisi Midtrans, jadi container akan
              // gagal render dan tombol "Buka pembayaran cadangan" jadi buntu.
              <div className="order-payment-preview">
                <div>
                  <small>Pembayaran</small>
                  <strong>Waktu pembayaran habis</strong>
                  <p>
                    {payment.name} tidak lagi berlaku untuk pesanan ini. Coba
                    lagi - datamu sudah kami siapkan.
                  </p>
                </div>
                <button type="button" onClick={cobaLagiDenganPrefill}>
                  Coba lagi
                </button>
              </div>
            ) : liveStatus === "pending_payment" && isDoku ? (
              <div className="midtrans-native-section">
                <div className="midtrans-native-head">
                  <div>
                    <small>Pembayaran via DOKU</small>
                    <strong>{payment.name}</strong>
                    <p>{payment.detail}</p>
                  </div>
                  <span>Diverifikasi otomatis oleh {BRAND.shortName}</span>
                </div>

                {dokuQrContent ? (
                  <DokuQrisPanel
                    qrContent={dokuQrContent}
                    amount={order.pricing.finalPrice}
                    expiresAt={order.doku?.expiresAt ?? order.expiresAt ?? null}
                  />
                ) : paylabsQrContent ? (
                  <DokuQrisPanel
                    qrContent={paylabsQrContent}
                    amount={order.pricing.finalPrice}
                    expiresAt={
                      order.paylabs?.expiresAt ?? order.expiresAt ?? null
                    }
                  />
                ) : paylabsVaNumber ? (
                  <div className="midtrans-native-payment">
                    <p>Nomor Virtual Account:</p>
                    <strong>{paylabsVaNumber}</strong>
                    <p>{order.paylabs?.bankCode}</p>
                  </div>
                ) : redirectUrl ? (
                  <div className="doku-checkout-cta">
                    <p>
                      Tinggal satu langkah — klik "Bayar sekarang" dan
                      selesaikan di jendela yang muncul.
                    </p>
                    <button
                      type="button"
                      className="order-action-button primary"
                      onClick={openDokuCheckout}
                    >
                      Bayar sekarang
                    </button>
                    <button
                      type="button"
                      className="order-secondary-link"
                      onClick={openFallbackPayment}
                    >
                      Buka di tab baru
                    </button>
                  </div>
                ) : (
                  <div className="midtrans-native-warning">
                    Pembayarannya belum siap. Klik "Periksa status" atau refresh
                    halaman.
                  </div>
                )}

                <div className="midtrans-native-footer">
                  <span>
                    Begitu kamu bayar, statusnya update otomatis — nggak perlu
                    kirim bukti transfer.
                  </span>
                </div>
              </div>
            ) : liveStatus === "pending_payment" ? (
              <div className="midtrans-native-section">
                <div className="midtrans-native-head">
                  <div>
                    <small>Pembayaran</small>
                    <strong>{payment.name}</strong>
                    <p>{payment.detail}</p>
                  </div>
                  <span>Diverifikasi otomatis oleh {BRAND.shortName}</span>
                </div>

                {!midtransClientKey && (
                  <div className="midtrans-native-warning">
                    Pembayarannya belum muncul. Refresh halaman, atau klik "Buka
                    di tab baru".
                  </div>
                )}
                {midtransClientKey && !snapReady && (
                  <div className="midtrans-native-loading">
                    Memuat pembayaran...
                  </div>
                )}

                <div id={SNAP_EMBED_ID} className="midtrans-snap-container" />

                <div className="midtrans-native-footer">
                  <span>
                    Pembayaranmu dicek otomatis sebelum pesanan diproses.
                  </span>
                  {(!midtransClientKey || !snapReady) && redirectUrl && (
                    <button type="button" onClick={openFallbackPayment}>
                      Buka pembayaran cadangan
                    </button>
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
                <button type="button" disabled>
                  {STATUS_LABEL[liveStatus]}
                </button>
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
              <small>
                {isPreview ? "Pratinjau" : STATUS_LABEL[liveStatus]}
              </small>
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
              {paymentChannel && (
                <div>
                  <dt>Channel</dt>
                  <dd>{paymentChannel}</dd>
                </div>
              )}
              {!isPreview && liveStatus === "success" && serialNumber && (
                <div>
                  <dt>Serial Number (SN)</dt>
                  <dd>
                    {serialNumber}{" "}
                    <button
                      type="button"
                      className="order-secondary-link"
                      onClick={() => void copySerialNumber()}
                    >
                      Salin
                    </button>
                  </dd>
                </div>
              )}
            </dl>

            <div className="order-price-breakdown">
              <div>
                <span>Harga</span>
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
                  <span>Referral</span>
                  <strong>-{formatIDR(pricing.referralDiscount)}</strong>
                </div>
              )}
              {pricing.pointsDiscount > 0 && (
                <div className="points-saving">
                  <span>
                    Lacte Points ·{" "}
                    {pricing.pointsRedeemed.toLocaleString("id-ID")} pts
                  </span>
                  <strong>-{formatIDR(pricing.pointsDiscount)}</strong>
                </div>
              )}
              {pricing.pointsEarned > 0 && (
                <div className="points-earned">
                  <span>Points setelah success</span>
                  <strong>
                    +{pricing.pointsEarned.toLocaleString("id-ID")} pts
                  </strong>
                </div>
              )}
              <div>
                <span>Biaya pembayaran</span>
                <strong>{formatIDR(pricing.customerPaymentFee)}</strong>
              </div>
            </div>

            <div className="order-grand-total">
              <span>Total pembayaran</span>
              <strong>{formatIDR(pricing.finalPrice)}</strong>
            </div>

            {/* Rating hanya setelah transaksi benar-benar selesai, dan form ini
                memakai access token order jadi hanya pemiliknya yang bisa kirim. */}
            {!isPreview && (
              <OrderRatingForm
                orderId={order!.id}
                accessToken={accessToken}
                isSuccess={liveStatus === "success"}
              />
            )}

            {/*
             * P4.5: slot promosi kecil — PALING BAWAH sticky card, di bawah
             * rating form. Hanya setelah transaksi tuntas (success /
             * awaiting_receivable); iklan di atas tombol bayar = gangguan,
             * dan pelanggan yang baru gagal tidak sedang mood belanja.
             * Isinya house-ad (promo aktif) — seam AdSense ada di komponen.
             */}
            {!isPreview &&
              (liveStatus === "success" ||
                liveStatus === "awaiting_receivable") && <OrderSummaryAdSlot />}

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
                      if (cta.action === "refresh" && order)
                        void refreshStatus(order.id);
                      if (cta.action === "new_order") cobaLagiDenganPrefill();
                      if (cta.action === "support")
                        window.open(
                          "mailto:support@nambah.id?subject=Order%20Inquiry",
                        );
                    }}
                  >
                    {busy && cta.action === "refresh"
                      ? "Memeriksa..."
                      : cta.label}
                  </button>
                ))}
              </div>
            )}

            {!isPreview && order?.refund && (
              <div className="order-refund-status">
                <strong>Status refund</strong>
                <p>
                  {order.refund.status === "completed"
                    ? `Refund ${formatIDR(order.refund.amount)} sudah selesai.`
                    : order.refund.status === "processing"
                      ? `Refund ${formatIDR(order.refund.amount)} sedang diproses.`
                      : order.refund.status === "failed"
                        ? "Refund gagal diproses. Hubungi CS untuk dibantu."
                        : order.refund.status === "rejected"
                          ? "Permintaan refund ditolak. Hubungi CS kalau kamu masih butuh bantuan."
                          : `Permintaan refund ${formatIDR(order.refund.amount)} sudah kami terima.`}
                </p>
              </div>
            )}

            {!isPreview &&
              !order?.refund &&
              (liveStatus === "success" ||
                (liveStatus === "failed" && order?.payment.paidAt)) && (
                <div className="order-refund-request">
                  <strong>Ada masalah dengan pesanan ini?</strong>
                  <textarea
                    value={refundReason}
                    rows={2}
                    placeholder="Ceritakan masalahnya, misalnya produk tidak masuk."
                    onChange={(event) => setRefundReason(event.target.value)}
                  />
                  <button
                    type="button"
                    className="order-action-button secondary"
                    disabled={refundBusy || refundReason.trim().length < 3}
                    onClick={() => void submitRefundRequest()}
                  >
                    {refundBusy ? "Mengirim..." : "Ajukan refund"}
                  </button>
                </div>
              )}

            <div className="order-secondary-links">
              <button
                className="order-secondary-link"
                type="button"
                onClick={() => void copyOrderId()}
              >
                Salin Order ID
              </button>
              <Link className="order-secondary-link" href="/#topup">
                Pesanan baru
              </Link>
              {order && accessToken && (
                <button
                  className="order-secondary-link"
                  type="button"
                  onClick={shareOrder}
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
