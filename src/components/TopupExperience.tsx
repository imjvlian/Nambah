"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Game, PaymentMethod } from "@/lib/catalog";
import { formatIDR, getReferenceDiscountPercent } from "@/lib/pricing";
import {
  createPublicPricingFallback,
  type PublicPricingResult,
} from "@/lib/public-pricing";

type PublicPaymentMethod = Pick<PaymentMethod, "id" | "name" | "detail">;
type ProductGroup = "hemat" | "populer" | "langganan" | "promo";
type GroupedPackage = Game["packages"][number] & { groups?: ProductGroup[] };
type UsernameCheckStatus = "idle" | "loading" | "success" | "pending" | "error";
type UsernameCheckState = {
  status: UsernameCheckStatus;
  nickname?: string;
  message?: string;
};
type NominalSectionId = "special" | "first-top-up" | "weekly-monthly" | "top-up";

type TopupExperienceProps = {
  games: Game[];
  paymentMethods: PublicPaymentMethod[];
  catalogSource: "static" | "supabase";
};

const GROUP_OPTIONS: Array<{ id: ProductGroup; label: string }> = [
  { id: "hemat", label: "Hemat" },
  { id: "populer", label: "Populer" },
  { id: "langganan", label: "Langganan" },
  { id: "promo", label: "Promo" },
];

const NOMINAL_SECTIONS: Array<{
  id: NominalSectionId;
  label: string;
  description: string;
  featured?: boolean;
}> = [
  {
    id: "special",
    label: "Item Spesial",
    description: "Pass, membership, dan item khusus.",
    featured: true,
  },
  {
    id: "first-top-up",
    label: "First Top Up",
    description: "Bonus pembelian pertama dan paket double.",
    featured: true,
  },
  {
    id: "weekly-monthly",
    label: "Paket Mingguan / Bulanan",
    description: "Paket berulang dengan periode mingguan atau bulanan.",
  },
  {
    id: "top-up",
    label: "Top Up",
    description: "Nominal reguler untuk top up instan.",
    featured: true,
  },
];

function groupsOf(item: Game["packages"][number]) {
  return ((item as GroupedPackage).groups ?? []) as ProductGroup[];
}

function isOnlyGroupNote(note?: string) {
  return Boolean(note && /^(hemat|populer|popular|langganan|promo)$/i.test(note.trim()));
}

function getPackageVisualKind(game: Game, item: Game["packages"][number]) {
  const text = `${game.name} ${item.label} ${item.note ?? ""}`.toLowerCase();
  if (/(weekly|pass|membership|member|starlight|langganan)/i.test(text)) return "pass";
  if (/(diamond|diamonds)/i.test(text)) return "diamond";
  if (/(\buc\b|unknown cash)/i.test(text)) return "uc";
  if (/robux/i.test(text)) return "robux";
  if (/(voucher|gift card|wallet)/i.test(text)) return "voucher";
  return "default";
}

function packageVisualLabel(kind: ReturnType<typeof getPackageVisualKind>) {
  if (kind === "diamond") return "◆";
  if (kind === "pass") return "PASS";
  if (kind === "uc") return "UC";
  if (kind === "robux") return "R$";
  if (kind === "voucher") return "V";
  return "N+";
}

function getNominalSectionId(item: Game["packages"][number]): NominalSectionId {
  const text = `${item.label} ${item.note ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /(first top up|first topup|first recharge|top up pertama|topup pertama|double diamond|double diamonds|double bonus)/i.test(
      text,
    )
  ) {
    return "first-top-up";
  }

  if (
    /(weekly elite pack|monthly elite pack|weekly epic pack|monthly epic pack|weekly pack|monthly pack|paket mingguan|paket bulanan)/i.test(
      text,
    )
  ) {
    return "weekly-monthly";
  }

  if (
    /(weekly diamond pass|twilight pass|starlight|battle pass|booyah pass|elite pass|membership|member|special item|special pack|special|\bpass\b)/i.test(
      text,
    )
  ) {
    return "special";
  }

  return "top-up";
}

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
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckState>({ status: "idle" });
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
  const canCheckUsername =
    selectedGame.requiresServer &&
    /mobile\s*legends?/i.test(`${selectedGame.name} ${selectedGame.shortName}`);

  const nominalSections = useMemo(
    () =>
      NOMINAL_SECTIONS.map((section) => ({
        ...section,
        items: selectedGame.packages.filter((item) => getNominalSectionId(item) === section.id),
      })).filter((section) => section.items.length > 0),
    [selectedGame],
  );

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

  function resetUsernameCheck() {
    setUsernameCheck({ status: "idle" });
  }

  function chooseGame(gameId: string) {
    const nextGame = games.find((game) => game.id === gameId) ?? defaultGame;
    setSelectedGameId(nextGame.id);
    setSelectedPackageId(nextGame.packages[0]!.id);
    setUserId("");
    setServerId("");
    resetUsernameCheck();
    resetPricingMessages();
    requestAnimationFrame(() => {
      document.getElementById("topup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function checkUsername() {
    const normalizedUserId = userId.trim();
    const normalizedServerId = serverId.trim();

    if (!normalizedUserId || !normalizedServerId) {
      setUsernameCheck({
        status: "error",
        message: "Isi User ID dan Server / Zone ID terlebih dahulu.",
      });
      return;
    }

    setUsernameCheck({ status: "loading", message: "Mengecek akun..." });

    try {
      const response = await fetch("/api/game-account/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: selectedGame.id,
          userId: normalizedUserId,
          serverId: normalizedServerId,
        }),
      });

      const data = (await response.json()) as {
        nickname?: string;
        message?: string;
        error?: string;
        pending?: boolean;
        verified?: boolean;
      };

      if (response.status === 202 || data.pending) {
        setUsernameCheck({
          status: "pending",
          message: data.message ?? "Checker masih memproses akun. Coba lagi sebentar.",
        });
        return;
      }

      if (!response.ok) {
        setUsernameCheck({
          status: "error",
          message: data.error ?? "Username tidak dapat diperiksa.",
        });
        return;
      }

      if (data.nickname) {
        setUsernameCheck({
          status: "success",
          nickname: data.nickname,
          message: "Akun ditemukan.",
        });
        return;
      }

      setUsernameCheck({
        status: data.verified ? "success" : "error",
        message: data.message ?? "Akun ditemukan, tetapi nickname tidak tersedia.",
      });
    } catch {
      setUsernameCheck({
        status: "error",
        message: "Tidak bisa terhubung ke username checker. Coba lagi.",
      });
    }
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
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: selectedGame.id,
          packageId: selectedPackage.id,
          paymentId: paymentMethod.id,
          targetUserId: userId.trim(),
          targetServerId: selectedGame.requiresServer ? serverId.trim() : undefined,
          promoCode: appliedPromoCode,
          referralCode: appliedReferralCode,
        }),
      });
      const data = (await response.json()) as { error?: string; order?: { id: string } };
      if (!response.ok || !data.order) {
        setNotice(data.error ?? "Gagal membuat pembayaran Midtrans Sandbox.");
        return;
      }
      router.push(`/order/${encodeURIComponent(data.order.id)}`);
    } catch {
      setNotice("Tidak bisa menyiapkan pembayaran Sandbox. Coba lagi.");
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
              <span className="game-mark app-artwork" style={{ background: game.accent }}>{game.initials}</span>
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
              ? "Katalog dan pricing dibaca dari database Nambah. Harga final divalidasi ulang saat order Midtrans Sandbox dibuat."
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
              <span className="selected-mark app-artwork" style={{ background: selectedGame.accent }}>{selectedGame.initials}</span>
              <div>
                <small>Produk dipilih</small>
                <strong>{selectedGame.name}</strong>
              </div>
            </div>
            <span className="preview-badge">{catalogSource === "supabase" ? "Sandbox Checkout" : "MVP Pricing"}</span>
          </div>

          <div className="form-block account-form-block">
            <div className="form-label">
              <span className="step-number">1</span>
              <div><strong>Data akun</strong><small>Pastikan ID yang dimasukkan benar.</small></div>
            </div>
            <div className={selectedGame.requiresServer ? "input-grid two" : "input-grid"}>
              <label>
                <span>User ID</span>
                <input
                  inputMode="numeric"
                  placeholder="Masukkan User ID"
                  value={userId}
                  onChange={(event) => {
                    setUserId(event.target.value);
                    resetUsernameCheck();
                  }}
                />
              </label>
              {selectedGame.requiresServer && (
                <label>
                  <span>Server / Zone ID</span>
                  <input
                    inputMode="numeric"
                    placeholder="Contoh: 1234"
                    value={serverId}
                    onChange={(event) => {
                      setServerId(event.target.value);
                      resetUsernameCheck();
                    }}
                  />
                </label>
              )}
            </div>

            {canCheckUsername && (
              <div className="username-checker">
                <button
                  className="username-checker-button"
                  type="button"
                  disabled={usernameCheck.status === "loading" || !userId.trim() || !serverId.trim()}
                  onClick={() => void checkUsername()}
                >
                  <span aria-hidden="true">◎</span>
                  {usernameCheck.status === "loading" ? "Mengecek..." : "Cek username"}
                </button>

                <div className={`username-checker-result ${usernameCheck.status}`} role="status">
                  {usernameCheck.status === "success" ? (
                    <>
                      <span className="username-checker-status" aria-hidden="true">✓</span>
                      <span><small>Username</small><strong>{usernameCheck.nickname ?? "Akun terverifikasi"}</strong></span>
                    </>
                  ) : usernameCheck.status === "pending" ? (
                    <>
                      <span className="username-checker-status" aria-hidden="true">…</span>
                      <span><small>Masih diproses</small><strong>{usernameCheck.message}</strong></span>
                    </>
                  ) : usernameCheck.status === "error" ? (
                    <>
                      <span className="username-checker-status" aria-hidden="true">!</span>
                      <span><small>Belum terverifikasi</small><strong>{usernameCheck.message}</strong></span>
                    </>
                  ) : (
                    <>
                      <span className="username-checker-status" aria-hidden="true">?</span>
                      <span><small>Opsional</small><strong>Cek nickname sebelum lanjut.</strong></span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="form-block nominal-form-block nominal-form-grouped">
            <div className="form-label">
              <span className="step-number">2</span>
              <div><strong>Pilih nominal</strong><small>Semua nominal ditampilkan sekaligus dan dikelompokkan berdasarkan jenis produk.</small></div>
            </div>

            <div className="nominal-section-stack">
              {nominalSections.map((section) => (
                <section className={`nominal-section nominal-section-${section.id}`} key={section.id}>
                  <div className="nominal-section-heading">
                    <div>
                      <strong>
                        {section.label}
                        {section.featured && <span className="nominal-section-spark" aria-hidden="true">✦</span>}
                      </strong>
                      <small>{section.description}</small>
                    </div>
                    <span>{section.items.length} pilihan</span>
                  </div>

                  <div className="package-grid package-grid-v3">
                    {section.items.map((item) => {
                      const referenceDiscount = getReferenceDiscountPercent(item.referencePrice, item.sellingPrice);
                      const groups = groupsOf(item);
                      const visualKind = getPackageVisualKind(selectedGame, item);
                      const active = selectedPackageId === item.id;

                      return (
                        <button
                          className={`package-option package-priced package-card-v3 ${active ? "active" : ""}`}
                          key={item.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setSelectedPackageId(item.id);
                            resetPricingMessages();
                          }}
                        >
                          <span className="package-card-v3-title">{item.label}</span>

                          <span className="package-card-v3-main">
                            <span className={`package-item-visual ${visualKind}`} aria-hidden="true">
                              {packageVisualLabel(visualKind)}
                            </span>
                            <span className="package-card-v3-price">
                              <strong className="package-current-price">{formatIDR(item.sellingPrice)}</strong>
                              {(item.referencePrice > item.sellingPrice || referenceDiscount > 0) && (
                                <span className="package-reference-row">
                                  {item.referencePrice > item.sellingPrice && <del>{formatIDR(item.referencePrice)}</del>}
                                  {referenceDiscount > 0 && <b>-{referenceDiscount}%</b>}
                                </span>
                              )}
                              {item.note && !isOnlyGroupNote(item.note) && (
                                <small className="package-note">{item.note}</small>
                              )}
                            </span>
                          </span>

                          <span className="package-card-v3-footer">
                            <span className="package-badges">
                              {groups.slice(0, 2).map((group) => (
                                <b className={`package-badge ${group}`} key={group}>
                                  {GROUP_OPTIONS.find((option) => option.id === group)?.label ?? group}
                                </b>
                              ))}
                            </span>
                            <span className="package-card-v3-brand">N+</span>
                            <span className="package-select-indicator" aria-hidden="true">{active ? "✓" : ""}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">3</span>
              <div><strong>Promo & referral</strong><small>Kode selalu divalidasi oleh backend, bukan dipercaya dari browser.</small></div>
            </div>

            <div className="discount-stack">
              <label className="discount-field">
                <span>Kode promo</span>
                <span className="discount-input-row">
                  <input autoCapitalize="characters" placeholder="Contoh: WELCOME" value={promoInput} onChange={(event) => setPromoInput(event.target.value.toUpperCase())} />
                  <button type="button" onClick={applyPromo}>Pakai</button>
                </span>
              </label>
              <label className="discount-field">
                <span>Kode referral <em>opsional</em></span>
                <span className="discount-input-row">
                  <input autoCapitalize="characters" placeholder="Contoh: TEMAN" value={referralInput} onChange={(event) => setReferralInput(event.target.value.toUpperCase())} />
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
                {pricing.referralDiscountCapped ? " Benefit disesuaikan otomatis agar transaksi tetap aman." : ""}
              </p>
            )}
            {(appliedPromoCode || appliedReferralCode) && pricing.rejectionReason && (
              <p className="inline-message warning">{pricing.rejectionReason}</p>
            )}
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">4</span>
              <div><strong>Metode pembayaran</strong><small>Selama flow test, pembayaran menggunakan Midtrans Sandbox dan tidak menagih uang asli.</small></div>
            </div>
            <div className="payment-list">
              {paymentMethods.map((method) => (
                <label className={`payment-option ${paymentId === method.id ? "active" : ""}`} key={method.id}>
                  <input checked={paymentId === method.id} name="payment" type="radio" value={method.id} onChange={() => setPaymentId(method.id)} />
                  <span className="radio-dot" />
                  <span><strong>{method.name}</strong><small>{method.detail}</small></span>
                </label>
              ))}
            </div>
          </div>

          <div className={`pricing-summary ${pricingLoading ? "is-loading" : ""}`}>
            <div className="pricing-product-row">
              <div><small>{selectedGame.shortName}</small><strong>{selectedPackage.label}</strong></div>
              <div className="summary-reference">
                {pricing.referencePrice > pricing.sellingPrice && <del>{formatIDR(pricing.referencePrice)}</del>}
                {pricing.referenceDiscountPercent > 0 && <span>-{pricing.referenceDiscountPercent}%</span>}
              </div>
            </div>
            <div className="summary-line"><span>Harga Nambah</span><strong>{formatIDR(pricing.sellingPrice)}</strong></div>
            {pricing.promotionDiscount > 0 && (
              <div className="summary-line discount"><span>Promo {pricing.promoCode}</span><strong>-{formatIDR(pricing.promotionDiscount)}</strong></div>
            )}
            {pricing.referralDiscount > 0 && (
              <div className="summary-line referral-benefit"><span>Benefit referral {pricing.referralCode}</span><strong>-{formatIDR(pricing.referralDiscount)}</strong></div>
            )}
            <div className="summary-line">
              <span>Biaya pembayaran</span>
              <strong>{pricing.customerPaymentFee === 0 ? "Rp0 (MVP)" : formatIDR(pricing.customerPaymentFee)}</strong>
            </div>
            <div className="summary-total"><span>Total</span><strong>{pricingLoading ? "Menghitung..." : formatIDR(pricing.finalPrice)}</strong></div>
          </div>

          <button className="primary-button full" disabled={isSubmitting || pricingLoading || Boolean(pricingError)} type="submit">
            {isSubmitting ? "Membuat pembayaran Sandbox..." : pricingLoading ? "Menghitung harga..." : "Lanjutkan pembayaran"} <span aria-hidden="true">→</span>
          </button>
          {notice && <p className="form-notice" role="status">{notice}</p>}
        </form>
      </section>
    </>
  );
}
