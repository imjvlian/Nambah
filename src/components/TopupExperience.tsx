"use client";

import { FormEvent, useMemo, useState } from "react";
import { games, paymentMethods } from "@/lib/catalog";
import {
  calculatePricing,
  findPromotion,
  formatIDR,
  getReferenceDiscountPercent,
  type PricingResult,
} from "@/lib/pricing";

export default function TopupExperience() {
  const [query, setQuery] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(games[0].id);
  const [selectedPackageId, setSelectedPackageId] = useState(
    games[0].packages[3]?.id ?? games[0].packages[0].id,
  );
  const [paymentId, setPaymentId] = useState(paymentMethods[0].id);
  const [userId, setUserId] = useState("");
  const [serverId, setServerId] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredGames = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return games;
    return games.filter((game) =>
      `${game.name} ${game.shortName}`.toLowerCase().includes(keyword),
    );
  }, [query]);

  const selectedGame = games.find((game) => game.id === selectedGameId) ?? games[0];
  const selectedPackage =
    selectedGame.packages.find((item) => item.id === selectedPackageId) ?? selectedGame.packages[0];
  const paymentMethod = paymentMethods.find((method) => method.id === paymentId) ?? paymentMethods[0];
  const activePromotion = findPromotion(appliedPromoCode);
  const pricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion: activePromotion,
    hasAffiliate: Boolean(referralCode.trim()),
  });

  function chooseGame(gameId: string) {
    const nextGame = games.find((game) => game.id === gameId) ?? games[0];
    setSelectedGameId(nextGame.id);
    setSelectedPackageId(nextGame.packages[0].id);
    setNotice("");
    setPromoMessage("");
    requestAnimationFrame(() => {
      document.getElementById("topup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function applyPromo() {
    const normalized = promoInput.trim().toUpperCase();
    setNotice("");

    if (!normalized) {
      setAppliedPromoCode("");
      setPromoMessage("Promo dihapus.");
      return;
    }

    const promotion = findPromotion(normalized);
    if (!promotion) {
      setAppliedPromoCode("");
      setPromoMessage("Kode promo tidak ditemukan.");
      return;
    }

    setAppliedPromoCode(promotion.code);
    setPromoInput(promotion.code);
    setPromoMessage(`${promotion.code} dipasang. Kelayakan promo dicek ulang saat checkout.`);
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

    if (!pricing.safeToCheckout) {
      setNotice(pricing.rejectionReason ?? "Harga belum aman untuk checkout.");
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
          referralCode,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        pricing?: PricingResult;
      };

      if (!response.ok || !data.pricing) {
        setNotice(data.error ?? "Harga gagal divalidasi.");
        return;
      }

      if (!data.pricing.safeToCheckout) {
        setNotice(data.pricing.rejectionReason ?? "Harga belum aman untuk checkout.");
        return;
      }

      setNotice(
        `Harga tervalidasi ${formatIDR(data.pricing.finalPrice)}. Checkout live akan aktif setelah supplier dan payment gateway terhubung.`,
      );
    } catch {
      setNotice("Tidak bisa memvalidasi harga. Coba lagi.");
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
            <button className="game-card" key={game.id} type="button" onClick={() => chooseGame(game.id)}>
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
            Harga Nambah, promo, dan referral dihitung terpisah. Harga supplier live akan menggantikan data MVP saat integrasi backend diaktifkan.
          </p>
          <div className="trust-list">
            <span><b>01</b> Harga jelas</span>
            <span><b>02</b> Promo terukur</span>
            <span><b>03</b> Referral terlacak</span>
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
            <span className="preview-badge">MVP Pricing</span>
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
                const referenceDiscount = getReferenceDiscountPercent(item.referencePrice, item.sellingPrice);
                return (
                  <button
                    className={`package-option package-priced ${selectedPackageId === item.id ? "active" : ""}`}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedPackageId(item.id);
                      setNotice("");
                      setPromoMessage("");
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
                <small>Promo mengurangi harga nyata. Referral tidak menambah harga customer.</small>
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
                <input
                  autoCapitalize="characters"
                  placeholder="Kode partner / teman"
                  value={referralCode}
                  onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                />
              </label>
            </div>

            {promoMessage && <p className="inline-message">{promoMessage}</p>}
            {appliedPromoCode && pricing.rejectionReason && (
              <p className="inline-message warning">{pricing.rejectionReason}</p>
            )}
            {referralCode.trim() && (
              <p className="referral-active">Referral {referralCode.trim().toUpperCase()} aktif · komisi partner dibayar dari profit Nambah.</p>
            )}
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">4</span>
              <div>
                <strong>Metode pembayaran</strong>
                <small>Fee live akan mengikuti gateway yang nanti dipilih.</small>
              </div>
            </div>
            <div className="payment-list">
              {paymentMethods.map((method) => (
                <label className={`payment-option ${paymentId === method.id ? "active" : ""}`} key={method.id}>
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

          <div className="pricing-summary">
            <div className="pricing-product-row">
              <div>
                <small>{selectedGame.shortName}</small>
                <strong>{selectedPackage.label}</strong>
              </div>
              <div className="summary-reference">
                <del>{formatIDR(pricing.referencePrice)}</del>
                {pricing.referenceDiscountPercent > 0 && <span>-{pricing.referenceDiscountPercent}%</span>}
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
            <div className="summary-line">
              <span>Biaya pembayaran</span>
              <strong>{pricing.customerPaymentFee === 0 ? "Rp0 (MVP)" : formatIDR(pricing.customerPaymentFee)}</strong>
            </div>
            {referralCode.trim() && (
              <div className="summary-line referral">
                <span>Referral</span>
                <strong>{referralCode.trim().toUpperCase()}</strong>
              </div>
            )}
            <div className="summary-total">
              <span>Total</span>
              <strong>{formatIDR(pricing.finalPrice)}</strong>
            </div>
          </div>

          <button className="primary-button full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Memvalidasi harga..." : "Lanjutkan pembayaran"} <span aria-hidden="true">→</span>
          </button>

          {notice && <p className="form-notice" role="status">{notice}</p>}
        </form>
      </section>
    </>
  );
}
