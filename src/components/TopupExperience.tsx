"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Game, PaymentMethod } from "@/lib/catalog";
import { formatIDR, getReferenceDiscountPercent } from "@/lib/pricing";
import {
  createPublicPricingFallback,
  type PublicPricingResult,
} from "@/lib/public-pricing";
import {
  createPreviewOrderId,
  previewOrderStorageKey,
  type PreviewOrder,
} from "@/lib/order-preview";

type TopupExperienceProps = {
  games: Game[];
  paymentMethods: PaymentMethod[];
  catalogSource: "static" | "supabase";
};

export default function TopupExperience({
  games,
  paymentMethods,
  catalogSource,
}: TopupExperienceProps) {
  const router = useRouter();
  const defaultGame = games[0]!;
  const defaultPackage = defaultGame.packages[3] ?? defaultGame.packages[0]!;
  const defaultPayment = paymentMethods[0]!;

  const [query, setQuery] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(defaultGame.id);
  const [selectedPackageId, setSelectedPackageId] = useState(defaultPackage.id);
  const [paymentId, setPaymentId] = useState(defaultPayment.id);
  const [userId, setUserId] = useState("");
  const [serverId, setServerId] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [referralInput, setReferralInput] = useState("");
  const [appliedReferralCode, setAppliedReferralCode] = useState("");
  const [referralMessage, setReferralMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [serverPricing, setServerPricing] = useState<PublicPricingResult | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [pricingLoading, setPricingLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredGames = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return games;
    return games.filter((game) =>
      `${game.name} ${game.shortName}`.toLowerCase().includes(keyword),
    );
  }, [games, query]);

  const selectedGame = games.find((game) => game.id === selectedGameId) ?? defaultGame;
  const selectedPackage =
    selectedGame.packages.find((item) => item.id === selectedPackageId) ??
    selectedGame.packages[0]!;
  const paymentMethod =
    paymentMethods.find((method) => method.id === paymentId) ?? defaultPayment;
  const pricing = serverPricing ?? createPublicPricingFallback(selectedPackage);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function refreshPricing() {
      setPricingLoading(true);
      setPricingError("");
      setServerPricing(null);

      try {
        const response = await fetch("/api/pricing/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: selectedGame.id,
            packageId: selectedPackage.id,
            paymentId: paymentMethod.id,
            promoCode: appliedPromoCode,
            referralCode: appliedReferralCode,
          }),
          signal: controller.signal,
        });

        const data = (await response.json()) as {
          error?: string;
          pricing?: PublicPricingResult;
        };

        if (!mounted) return;

        if (!response.ok || !data.pricing) {
          setPricingError(data.error ?? "Harga gagal dihitung.");
          if (appliedPromoCode) setPromoMessage("");
          if (appliedReferralCode) setReferralMessage("");
          return;
        }

        setServerPricing(data.pricing);

        if (appliedPromoCode && data.pricing.promoCode === appliedPromoCode) {
          setPromoMessage(`${appliedPromoCode} aktif. Harga sudah dihitung ulang.`);
        }

        if (appliedReferralCode && data.pricing.referralCode === appliedReferralCode) {
          setReferralMessage(`${appliedReferralCode} aktif. Benefit dihitung otomatis.`);
        }
      } catch (error) {
        if (!mounted || (error instanceof DOMException && error.name === "AbortError")) return;
        setPricingError("Tidak bisa menghitung harga. Coba lagi.");
      } finally {
        if (mounted) setPricingLoading(false);
      }
    }

    void refreshPricing();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [
    selectedGame.id,
    selectedPackage.id,
    paymentMethod.id,
    appliedPromoCode,
    appliedReferralCode,
  ]);

  function resetPricingMessages() {
    setNotice("");
    setPromoMessage("");
    setReferralMessage("");
  }

  function chooseGame(gameId: string) {
    const nextGame = games.find((game) => game.id === gameId) ?? defaultGame;
    setSelectedGameId(nextGame.id);
    setSelectedPackageId(nextGame.packages[0]!.id);
    setUserId("");
    setServerId("");
    resetPricingMessages();
    requestAnimationFrame(() => {
      document.getElementById("topup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function applyPromo() {
    const normalized = promoInput.trim().toUpperCase();
    setNotice("");
    setPricingError("");

    if (!normalized) {
      setAppliedPromoCode("");
      setPromoMessage("Promo dihapus.");
      return;
    }

    setAppliedPromoCode(normalized);
    setPromoInput(normalized);
    setPromoMessage(`${normalized} dipasang. Server sedang memvalidasi kode.`);
  }

  function applyReferral() {
    const normalized = referralInput.trim().toUpperCase();
    setNotice("");
    setPricingError("");

    if (!normalized) {
      setAppliedReferralCode("");
      setReferralMessage("Referral dihapus.");
      return;
    }

    setAppliedReferralCode(normalized);
    setReferralInput(normalized);
    setReferralMessage(`${normalized} dipasang. Server sedang memvalidasi kode.`);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");

    if (!userId.trim()) {
      setNotice("Masukkan User ID terlebih dahulu.");
      return;
    }

    if (selectedGame.requiresServer && !serverId.trim()) {
      setNotice("Masukkan Server / Zone ID terlebih dahulu.");
      return;
    }

    if (!serverPricing) {
      setNotice(pricingError || "Harga belum tervalidasi. Coba lagi.");
      return;
    }

    if (!serverPricing.safeToCheckout) {
      setNotice(serverPricing.rejectionReason ?? "Harga belum aman untuk checkout.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/pricing/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: selectedGame.id,
          packageId: selectedPackage.id,
          paymentId: paymentMethod.id,
          promoCode: appliedPromoCode,
          referralCode: appliedReferralCode,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        pricing?: PublicPricingResult;
      };

      if (!response.ok || !data.pricing) {
        setNotice(data.error ?? "Harga gagal divalidasi.");
        return;
      }

      if (!data.pricing.safeToCheckout) {
        setNotice(data.pricing.rejectionReason ?? "Harga belum aman untuk checkout.");
        return;
      }

      const orderId = createPreviewOrderId();
      const previewOrder: PreviewOrder = {
        id: orderId,
        createdAt: new Date().toISOString(),
        mode: "preview",
        status: "waiting_payment",
        product: {
          gameId: selectedGame.id,
          gameName: selectedGame.name,
          shortName: selectedGame.shortName,
          packageId: selectedPackage.id,
          packageLabel: selectedPackage.label,
          accent: selectedGame.accent,
          initials: selectedGame.initials,
        },
        account: {
          userId: userId.trim(),
          ...(selectedGame.requiresServer && serverId.trim()
            ? { serverId: serverId.trim() }
            : {}),
        },
        payment: {
          id: paymentMethod.id,
          name: paymentMethod.name,
          detail: paymentMethod.detail,
        },
        pricing: data.pricing,
        ...(appliedPromoCode ? { promoCode: appliedPromoCode } : {}),
        ...(appliedReferralCode ? { referralCode: appliedReferralCode } : {}),
      };

      window.localStorage.setItem(
        previewOrderStorageKey(orderId),
        JSON.stringify(previewOrder),
      );
      router.push(`/order/${encodeURIComponent(orderId)}`);
    } catch {
      setNotice("Tidak bisa menyiapkan pesanan. Coba lagi.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <section className="catalog-section" id="games">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Pilih produk</span>
            <h2>Mau nambah apa?</h2>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Cari game"
              type="search"
              placeholder="Cari game atau voucher"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="game-grid">
          {filteredGames.map((game) => (
            <button
              className="game-card"
              key={game.id}
              type="button"
              onClick={() => chooseGame(game.id)}
            >
              <span className="game-mark" style={{ background: game.accent }}>
                {game.initials}
              </span>
              <span className="game-copy">
                <strong>{game.name}</strong>
                <small>{game.category === "game" ? "Top up instan" : "Voucher digital"}</small>
              </span>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>

        {filteredGames.length === 0 && (
          <div className="empty-state">Belum ada produk yang cocok dengan pencarianmu.</div>
        )}
      </section>

      <section className="topup-section" id="topup">
        <div className="topup-intro">
          <span className="eyebrow">Checkout</span>
          <h2>Top up tanpa muter-muter.</h2>
          <p>
            {catalogSource === "supabase"
              ? "Katalog dan pricing dibaca dari database Nambah. Harga final tetap divalidasi ulang oleh server saat checkout."
              : "Harga Nambah, promo, dan benefit referral dihitung terpisah. Static fallback tetap aktif sampai database Nambah dihubungkan."}
          </p>
          <div className="trust-list">
            <span><b>01</b> Harga jelas</span>
            <span><b>02</b> Promo terukur</span>
            <span><b>03</b> Referral menguntungkan</span>
          </div>
        </div>

        <form className="order-card" onSubmit={submitOrder}>
          <div className="order-head">
            <div className="selected-product">
              <span className="selected-mark" style={{ background: selectedGame.accent }}>
                {selectedGame.initials}
              </span>
              <div>
                <small>Produk dipilih</small>
                <strong>{selectedGame.name}</strong>
              </div>
            </div>
            <span className="preview-badge">
              {catalogSource === "supabase" ? "Database Pricing" : "MVP Pricing"}
            </span>
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">1</span>
              <div>
                <strong>Data akun</strong>
                <small>Pastikan ID yang dimasukkan benar.</small>
              </div>
            </div>
            <div className={selectedGame.requiresServer ? "input-grid two" : "input-grid"}>
              <label>
                <span>User ID</span>
                <input
                  inputMode="numeric"
                  placeholder="Masukkan User ID"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                />
              </label>
              {selectedGame.requiresServer && (
                <label>
                  <span>Server / Zone ID</span>
                  <input
                    inputMode="numeric"
                    placeholder="Contoh: 1234"
                    value={serverId}
                    onChange={(event) => setServerId(event.target.value)}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">2</span>
              <div>
                <strong>Pilih nominal</strong>
                <small>Harga coret adalah reference price, bukan biaya promo.</small>
              </div>
            </div>
            <div className="package-grid">
              {selectedGame.packages.map((item) => {
                const referenceDiscount = getReferenceDiscountPercent(
                  item.referencePrice,
                  item.sellingPrice,
                );
                return (
                  <button
                    className={`package-option package-priced ${selectedPackageId === item.id ? "active" : ""}`}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedPackageId(item.id);
                      resetPricingMessages();
                    }}
                  >
                    <span className="package-name">{item.label}</span>
                    <span className="package-current-price">{formatIDR(item.sellingPrice)}</span>
                    <span className="package-reference-row">
                      <del>{formatIDR(item.referencePrice)}</del>
                      {referenceDiscount > 0 && <b>-{referenceDiscount}%</b>}
                    </span>
                    {item.note && <small>{item.note}</small>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">3</span>
              <div>
                <strong>Promo & referral</strong>
                <small>Kode selalu divalidasi oleh backend, bukan dipercaya dari browser.</small>
              </div>
            </div>

            <div className="discount-stack">
              <label className="discount-field">
                <span>Kode promo</span>
                <span className="discount-input-row">
                  <input
                    autoCapitalize="characters"
                    placeholder="Contoh: WELCOME"
                    value={promoInput}
                    onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
                  />
                  <button type="button" onClick={applyPromo}>Pakai</button>
                </span>
              </label>

              <label className="discount-field">
                <span>Kode referral <em>opsional</em></span>
                <span className="discount-input-row">
                  <input
                    autoCapitalize="characters"
                    placeholder="Contoh: TEMAN"
                    value={referralInput}
                    onChange={(event) => setReferralInput(event.target.value.toUpperCase())}
                  />
                  <button type="button" onClick={applyReferral}>Pakai</button>
                </span>
              </label>
            </div>

            {promoMessage && <p className="inline-message">{promoMessage}</p>}
            {referralMessage && <p className="inline-message referral-message">{referralMessage}</p>}
            {pricingError && <p className="inline-message warning">{pricingError}</p>}

            {pricing.referralCode && pricing.referralDiscount > 0 && (
              <p className="referral-active">
                Referral {pricing.referralCode} aktif · kamu hemat {formatIDR(pricing.referralDiscount)} · partner mendapat {Math.round(pricing.affiliateRate * 100)}% dari net profit.
                {pricing.referralDiscountCapped
                  ? " Benefit disesuaikan otomatis agar transaksi tetap aman."
                  : ""}
              </p>
            )}

            {(appliedPromoCode || appliedReferralCode) && pricing.rejectionReason && (
              <p className="inline-message warning">{pricing.rejectionReason}</p>
            )}
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">4</span>
              <div>
                <strong>Metode pembayaran</strong>
                <small>Midtrans dipilih untuk gateway production. Fee live mengikuti rate merchant yang disetujui.</small>
              </div>
            </div>
            <div className="payment-list">
              {paymentMethods.map((method) => (
                <label
                  className={`payment-option ${paymentId === method.id ? "active" : ""}`}
                  key={method.id}
                >
                  <input
                    checked={paymentId === method.id}
                    name="payment"
                    type="radio"
                    value={method.id}
                    onChange={() => setPaymentId(method.id)}
                  />
                  <span className="radio-dot" />
                  <span>
                    <strong>{method.name}</strong>
                    <small>{method.detail}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className={`pricing-summary ${pricingLoading ? "is-loading" : ""}`}>
            <div className="pricing-product-row">
              <div>
                <small>{selectedGame.shortName}</small>
                <strong>{selectedPackage.label}</strong>
              </div>
              <div className="summary-reference">
                <del>{formatIDR(pricing.referencePrice)}</del>
                {pricing.referenceDiscountPercent > 0 && (
                  <span>-{pricing.referenceDiscountPercent}%</span>
                )}
              </div>
            </div>

            <div className="summary-line">
              <span>Harga Nambah</span>
              <strong>{formatIDR(pricing.sellingPrice)}</strong>
            </div>
            {pricing.promotionDiscount > 0 && (
              <div className="summary-line discount">
                <span>Promo {pricing.promoCode}</span>
                <strong>-{formatIDR(pricing.promotionDiscount)}</strong>
              </div>
            )}
            {pricing.referralDiscount > 0 && (
              <div className="summary-line referral-benefit">
                <span>Benefit referral {pricing.referralCode}</span>
                <strong>-{formatIDR(pricing.referralDiscount)}</strong>
              </div>
            )}
            <div className="summary-line">
              <span>Biaya pembayaran</span>
              <strong>
                {pricing.customerPaymentFee === 0
                  ? "Rp0 (MVP)"
                  : formatIDR(pricing.customerPaymentFee)}
              </strong>
            </div>
            <div className="summary-total">
              <span>Total</span>
              <strong>{pricingLoading ? "Menghitung..." : formatIDR(pricing.finalPrice)}</strong>
            </div>
          </div>

          <button
            className="primary-button full"
            disabled={isSubmitting || pricingLoading || Boolean(pricingError)}
            type="submit"
          >
            {isSubmitting
              ? "Menyiapkan pesanan..."
              : pricingLoading
                ? "Menghitung harga..."
                : "Lanjutkan pembayaran"} <span aria-hidden="true">→</span>
          </button>

          {notice && <p className="form-notice" role="status">{notice}</p>}
        </form>
      </section>
    </>
  );
}
