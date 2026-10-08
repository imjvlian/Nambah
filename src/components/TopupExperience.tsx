"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Game, PaymentMethod } from "@/lib/catalog";
import {
  accountFieldOptionLabel,
  accountFieldOptionValue,
  getGameAccountSchema,
  sanitizeAccountField,
  validateGameAccountTarget,
} from "@/lib/game-account";
import { formatIDR, getReferenceDiscountPercent } from "@/lib/pricing";
import { sortNominalItems } from "@/lib/nominal-sort";
import { validateGuestReceiptContact } from "@/lib/customer-contact";
import {
  createPublicPricingFallback,
  type PublicPricingResult,
} from "@/lib/public-pricing";

type PublicPaymentMethod = Pick<PaymentMethod, "id" | "name" | "detail">;
type ProductGroup = "hemat" | "populer" | "langganan" | "promo";
type GroupedPackage = Game["packages"][number] & { groups?: ProductGroup[] };
type ProductArtwork = {
  src: string;
  alt: string;
  kind: "nominal" | "cover";
};
type UsernameCheckStatus = "idle" | "loading" | "success" | "pending" | "error";
type UsernameCheckState = {
  status: UsernameCheckStatus;
  nickname?: string;
  server?: string;
  region?: string | null;
  message?: string;
};
type NominalSectionId = "special" | "first-top-up" | "weekly-monthly" | "top-up";

type PointsSummary = {
  balance: number;
  reserved: number;
  available: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  rules: {
    pointValueIdr: number;
    earnEveryIdr: number;
    minimumRedeem: number;
    redeemStep: number;
    maxRedeemRate: number;
  };
};

type PendingCheckout = {
  targetUserId: string;
  targetServerId: string;
  guestContact: { email: string; whatsapp: string } | null;
};

type TopupExperienceProps = {
  games: Game[];
  paymentMethods: PublicPaymentMethod[];
  catalogSource: "static" | "supabase";
  artworkByGameId?: Record<string, ProductArtwork | null>;
  artworkByPackageId?: Record<string, ProductArtwork | null>;
  /**
   * Konten untuk kolom kiri. Kalau diisi, blok intro "Checkout" digantikan.
   * Halaman produk memakainya untuk kartu rating; beranda membiarkan intro
   * tetap tampil karena di sana checkout memang jadi pesan utama.
   */
  railPanel?: ReactNode;
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

function promoCountdownLabel(endsAt: string, now: number) {
  const remaining = new Date(endsAt).getTime() - now;
  if (remaining <= 0) return null;
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds >= 24 * 3600) {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    return `${days}h ${hours}j`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function groupsOf(item: Game["packages"][number]) {
  return ((item as GroupedPackage).groups ?? []) as ProductGroup[];
}

/**
 * Catatan yang isinya sudah tercermin sebagai badge grup (hemat, langganan,
 * membership, dst) tidak dirender dua kali.
 */
function isOnlyGroupNote(note?: string) {
  return Boolean(
    note &&
      /^(hemat|populer|popular|langganan|promo|membership|member|weekly|monthly|pass|subscription|subscribe)$/i.test(
        note.trim(),
      ),
  );
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
    /(weekly elite pack|monthly elite pack|weekly epic pack|monthly epic pack|weekly pack|monthly pack|weekly card|monthly card|paket mingguan|paket bulanan)/i.test(
      text,
    )
  ) {
    return "weekly-monthly";
  }

  if (
    /(weekly diamond pass|twilight pass|starlight|battle pass|booyah pass|elite pass|membership|member|welkin|lunite subscription|special item|special pack|special|\bpass\b)/i.test(
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
  artworkByGameId = {},
  artworkByPackageId = {},
  railPanel,
}: TopupExperienceProps) {
  const router = useRouter();
  const defaultGame = games[0]!;
  const defaultPackage = defaultGame.packages[3] ?? defaultGame.packages[0]!;
  const defaultPayment = paymentMethods[0]!;

  const [query, setQuery] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(defaultGame.id);
  const [selectedPackageId, setSelectedPackageId] = useState(defaultPackage.id);
  const promoSectionRef = useRef<HTMLDivElement | null>(null);
  
  const [paymentId, setPaymentId] = useState(defaultPayment.id);
  const [userId, setUserId] = useState("");
  const [serverId, setServerId] = useState("");
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckState>({ status: "idle" });
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [promoEndsAt, setPromoEndsAt] = useState<string | null>(null);
  const [promoCountdownNow, setPromoCountdownNow] = useState(() => Date.now());
  const [referralInput, setReferralInput] = useState("");
  const [appliedReferralCode, setAppliedReferralCode] = useState("");
  const [referralMessage, setReferralMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [accountError, setAccountError] = useState("");
  const [viewerState, setViewerState] = useState<"loading" | "guest" | "authenticated">("loading");
  const [pointsSummary, setPointsSummary] = useState<PointsSummary | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestWhatsapp, setGuestWhatsapp] = useState("");
  const [contactError, setContactError] = useState("");
  const [serverPricing, setServerPricing] = useState<PublicPricingResult | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [pricingLoading, setPricingLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
const [confirmOpen, setConfirmOpen] = useState(false);
const [viewerEmail, setViewerEmail] = useState("");
const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
const confirmCloseRef = useRef<HTMLButtonElement | null>(null);

  const filteredGames = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return games;
    return games.filter((game) =>
      `${game.name} ${game.shortName}`.toLowerCase().includes(keyword),
    );
  }, [games, query]);

  const selectedGame = games.find((game) => game.id === selectedGameId) ?? defaultGame;
  const accountSchema = getGameAccountSchema(selectedGame);
  const canCheckUsername = Boolean(accountSchema.checker);

  const bestDealItems = useMemo(() => {
    const ids = selectedGame.popularPackageIds ?? [];
    if (ids.length === 0) return [];
    const order = new Map(ids.map((id, index) => [id, index]));
    return selectedGame.packages
      .filter((item) => order.has(item.id))
      .sort((left, right) => order.get(left.id)! - order.get(right.id)!);
  }, [selectedGame]);

  /**
   * Alur pilih nominal dipakai semua kartu, termasuk seksi Best Deals, supaya
   * perilaku auto scroll-nya sama: data akun dulu, baru promo. Belum valid ->
   * scroll ke step 1 + tampilkan errornya; sudah valid -> lanjut ke promo.
   */
  function selectPackage(item: Game["packages"][number]) {
    setSelectedPackageId(item.id);
    resetPricingMessages();

    const account = validateGameAccountTarget(selectedGame, userId, serverId);
    if (!account.ok) {
      setAccountError(account.error);
      document
        .getElementById("account-data")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    promoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /**
   * Satu kartu compact untuk semua nominal — dipakai seksi Best Deals maupun
   * tiap seksi nominal, supaya tampilannya identik di mana pun. Badge peringkat
   * sengaja tidak ada: penanda sudah lewat dari posisi di seksi Best Deals.
   */
  function renderPackageCard(
    item: Game["packages"][number],
    options: { keyPrefix: string; onSelect: () => void },
  ) {
    const { keyPrefix, onSelect } = options;
    const referenceDiscount = getReferenceDiscountPercent(
      item.referencePrice,
      item.sellingPrice,
    );
    const groups = groupsOf(item);
    const visualKind = getPackageVisualKind(selectedGame, item);
    const artwork = artworkByPackageId[item.id];
    const active = selectedPackageId === item.id;
    const showReference = item.referencePrice > item.sellingPrice;

    return (
      <button
        className={`package-option package-priced package-card-v4 ${active ? "active" : ""}`}
        key={`${keyPrefix}-${item.id}`}
        type="button"
        aria-pressed={active}
        onClick={onSelect}
      >
        <span
          className={`package-item-visual ${visualKind} package-card-v4-visual`}
          aria-hidden={artwork ? undefined : true}
          style={artwork ? { overflow: "hidden", padding: 2 } : undefined}
        >
          {artwork ? (
            <img
              src={artwork.src}
              alt={artwork.alt}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          ) : (
            packageVisualLabel(visualKind)
          )}
        </span>

        <span className="package-card-v4-body">
          <span className="package-card-v4-title">{item.label}</span>
        </span>

        <span className="package-card-v4-price">
          <strong className="package-current-price">{formatIDR(item.sellingPrice)}</strong>
          {(showReference || referenceDiscount > 0) && (
            <span className="package-reference-row">
              {showReference && <del>{formatIDR(item.referencePrice)}</del>}
              {referenceDiscount > 0 && <b>-{referenceDiscount}%</b>}
            </span>
          )}
        </span>

        {(groups.length > 0 || (item.note && !isOnlyGroupNote(item.note))) && (
          <span className="package-card-v4-meta">
            {groups.slice(0, 2).map((group) => (
              <b className={`package-badge ${group}`} key={group}>
                {GROUP_OPTIONS.find((option) => option.id === group)?.label ?? group}
              </b>
            ))}
            {item.note && !isOnlyGroupNote(item.note) && (
              <b className="package-badge package-badge-note">{item.note}</b>
            )}
          </span>
        )}
      </button>
    );
  }

  const nominalSections = useMemo(
    () =>
      NOMINAL_SECTIONS.map((section) => ({
        ...section,
        items: sortNominalItems(
          selectedGame.packages.filter((item) => getNominalSectionId(item) === section.id),
        ),
      })).filter((section) => section.items.length > 0),
    [selectedGame],
  );

  const selectedPackage =
    selectedGame.packages.find((item) => item.id === selectedPackageId) ??
    selectedGame.packages[0]!;
  const paymentMethod =
    paymentMethods.find((method) => method.id === paymentId) ?? defaultPayment;
  const pricing = serverPricing ?? createPublicPricingFallback(selectedPackage);
  const selectedGameArtwork = artworkByGameId[selectedGame.id];

  const maxPointsForOrder = useMemo(() => {
    if (!pointsSummary) return 0;
    const subtotalBeforePoints = Math.max(
      0,
      pricing.sellingPrice -
        pricing.promotionDiscount -
        pricing.referralDiscount,
    );
    const maxDiscount = Math.floor(
      subtotalBeforePoints * pointsSummary.rules.maxRedeemRate,
    );
    const maxFromOrder = Math.floor(
      maxDiscount / pointsSummary.rules.pointValueIdr,
    );
    const step = pointsSummary.rules.redeemStep;
    const orderStepped = Math.floor(maxFromOrder / step) * step;
    const availableStepped =
      Math.floor(pointsSummary.available / step) * step;
    return Math.max(0, Math.min(orderStepped, availableStepped));
  }, [
    pointsSummary,
    pricing.sellingPrice,
    pricing.promotionDiscount,
    pricing.referralDiscount,
  ]);

  useEffect(() => {
    let mounted = true;

    async function resolveViewer() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!mounted) return;

        setViewerState(response.ok ? "authenticated" : "guest");
        if (response.ok) {
          setContactError("");
          // Email akun dipakai sebagai tujuan receipt pada ringkasan konfirmasi.
          const meData = (await response.json().catch(() => null)) as {
            user?: { email?: string } | null;
          } | null;
          if (!mounted) return;
          setViewerEmail(meData?.user?.email ?? "");
          setPointsLoading(true);
          try {
            const pointsResponse = await fetch("/api/account/points", {
              cache: "no-store",
              credentials: "same-origin",
            });
            const pointsData = (await pointsResponse.json()) as {
              points?: PointsSummary;
              error?: string;
            };
            if (!mounted) return;
            if (pointsResponse.ok && pointsData.points) {
              setPointsSummary(pointsData.points);
              setPointsError("");
            } else {
              setPointsError(
                pointsData.error ?? "Nambah Points belum dapat dimuat.",
              );
            }
          } catch {
            if (mounted) setPointsError("Nambah Points belum dapat dimuat.");
          } finally {
            if (mounted) setPointsLoading(false);
          }
        } else {
          setPointsSummary(null);
          setPointsToRedeem(0);
          setViewerEmail("");
        }
      } catch {
        if (mounted) setViewerState("guest");
      }
    }

    void resolveViewer();
    return () => {
      mounted = false;
    };
  }, []);

  // Escape menutup ringkasan konfirmasi; fokus dikembalikan ke tombol
  // "Kembali" supaya keyboard user tidak tersesat di dalam dialog.
  useEffect(() => {
    if (!confirmOpen) return;

    confirmCloseRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || isSubmitting) return;
      setConfirmOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen, isSubmitting]);

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
            pointsToRedeem,
          }),
          signal: controller.signal,
        });

        const data = (await response.json()) as {
          error?: string;
          pricing?: PublicPricingResult;
          points?: PointsSummary | null;
          promoEndsAt?: string | null;
        };

        if (!mounted) return;
        if (!response.ok || !data.pricing) {
          setPricingError(data.error ?? "Harga gagal dihitung.");
          setPromoEndsAt(null);
          if (appliedPromoCode) setPromoMessage("");
          if (appliedReferralCode) setReferralMessage("");
          return;
        }

        setServerPricing(data.pricing);
        setPromoEndsAt(data.promoEndsAt ?? null);
        if (data.points) setPointsSummary(data.points);
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
    pointsToRedeem,
  ]);

  // Ticker countdown promo — hanya berdetak selama promo berbatas waktu aktif.
  useEffect(() => {
    if (!promoEndsAt) return;
    const timer = setInterval(() => setPromoCountdownNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [promoEndsAt]);

  useEffect(() => {
    const account = validateGameAccountTarget(selectedGame, userId, serverId);
    if (!canCheckUsername || !account.ok || !account.serverId) {
      setUsernameCheck({ status: "idle" });
      return;
    }

    const normalizedUserId = account.userId;
    const normalizedServerId = account.serverId;
    const controller = new AbortController();
    let mounted = true;

    const timer = window.setTimeout(async () => {
      setUsernameCheck({ status: "loading", message: "Memeriksa akun..." });

      try {
        const response = await fetch("/api/game-account/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: selectedGame.id,
            userId: normalizedUserId,
            serverId: normalizedServerId,
          }),
          signal: controller.signal,
        });

        const data = (await response.json()) as {
          nickname?: string;
          server?: string;
          region?: string | null;
          message?: string;
          error?: string;
          pending?: boolean;
          verified?: boolean;
          localOnly?: boolean;
        };

        if (!mounted) return;

        if (data.localOnly) {
          setUsernameCheck({
            status: "pending",
            server: normalizedServerId,
            message:
              data.message ??
              "Format akun sudah sesuai, pengecekan otomatis tidak tersedia untuk produk ini.",
          });
          return;
        }

        if (response.status === 202 || data.pending) {
          setUsernameCheck({
            status: "pending",
            message: data.message ?? "Pengecekan akun masih diproses.",
          });
          return;
        }

        if (!response.ok) {
          setUsernameCheck({
            status: "error",
            message: data.error ?? "ID atau Server tidak valid.",
          });
          return;
        }

        if (data.nickname) {
          setUsernameCheck({
            status: "success",
            nickname: data.nickname,
            server: data.server ?? normalizedServerId,
            region: data.region ?? null,
            message: "Akun ditemukan.",
          });
          return;
        }

        setUsernameCheck({
          status: data.verified ? "success" : "error",
          server: data.server ?? normalizedServerId,
          region: data.region ?? null,
          message: data.message ?? "Akun ditemukan, tetapi nickname tidak tersedia.",
        });
      } catch (error) {
        if (!mounted || (error instanceof DOMException && error.name === "AbortError")) return;
        setUsernameCheck({
          status: "error",
          message: "Pengecekan akun sedang tidak tersedia. Checkout tetap bisa dilanjutkan.",
        });
      }
    }, 700);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canCheckUsername, selectedGame, userId, serverId]);

  function resetPricingMessages() {
    setNotice("");
    setPromoMessage("");
    setReferralMessage("");
    setPointsToRedeem(0);
  }

  function chooseGame(gameId: string) {
    const nextGame = games.find((game) => game.id === gameId) ?? defaultGame;
    setSelectedGameId(nextGame.id);
    setSelectedPackageId(nextGame.packages[0]!.id);
    setUserId("");
    setServerId("");
    setAccountError("");
    setUsernameCheck({ status: "idle" });
    resetPricingMessages();
    requestAnimationFrame(() => {
      document.getElementById("topup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function applyPromo() {
    const normalized = promoInput.trim().toUpperCase();
    setPointsToRedeem(0);
    setNotice("");
    setPricingError("");
    if (!normalized) {
      setAppliedPromoCode("");
      setPromoMessage("Promo dihapus.");
      return;
    }
    if (viewerState !== "authenticated") {
      setAppliedPromoCode("");
      setPromoMessage(
        "Kode promo hanya untuk pengguna login. Masuk atau daftar gratis dulu, baru pakai kodenya.",
      );
      return;
    }
    setAppliedPromoCode(normalized);
    setPromoInput(normalized);
    setPromoMessage(`${normalized} dipasang. Server sedang memvalidasi kode.`);
  }

  function applyReferral() {
    const normalized = referralInput.trim().toUpperCase();
    setPointsToRedeem(0);
    setNotice("");
    setPricingError("");
    if (!normalized) {
      setAppliedReferralCode("");
      setReferralMessage("Referral dihapus.");
      return;
    }
    if (viewerState !== "authenticated") {
      setAppliedReferralCode("");
      setReferralMessage(
        "Kode referral hanya untuk pengguna login. Masuk atau daftar gratis dulu, baru pakai kodenya.",
      );
      return;
    }
    setAppliedReferralCode(normalized);
    setReferralInput(normalized);
    setReferralMessage(`${normalized} dipasang. Server sedang memvalidasi kode.`);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setAccountError("");
    setContactError("");

    const account = validateGameAccountTarget(selectedGame, userId, serverId);
    if (!account.ok) {
      setAccountError(account.error);
      requestAnimationFrame(() => {
        document.getElementById("account-data")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      return;
    }

    let guestContact: { email: string; whatsapp: string } | null = null;
    if (viewerState === "loading") {
      setContactError("Status akun masih diperiksa. Coba lagi sebentar.");
      return;
    }
    if (viewerState === "guest") {
      const contact = validateGuestReceiptContact(guestEmail, guestWhatsapp);
      if (!contact.ok) {
        setContactError(contact.error);
        requestAnimationFrame(() => {
          document.getElementById("receipt-contact")?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
        return;
      }
      guestContact = { email: contact.email, whatsapp: contact.whatsapp };
    }

    if (!serverPricing) {
      setNotice(pricingError || "Harga belum tervalidasi. Coba lagi.");
      return;
    }
    if (!serverPricing.safeToCheckout) {
      setNotice(serverPricing.rejectionReason ?? "Harga belum aman untuk checkout.");
      return;
    }

    // Semua input sudah valid: simpan payload dan tampilkan ringkasan dulu.
    // Order baru dibuat setelah pengguna menekan tombol konfirmasi.
    setPendingCheckout({
      targetUserId: account.userId,
      targetServerId: account.serverId ?? "",
      guestContact,
    });
    setConfirmOpen(true);
  }

  async function confirmCheckout() {
    if (!pendingCheckout) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: selectedGame.id,
          packageId: selectedPackage.id,
          paymentId: paymentMethod.id,
          targetUserId: pendingCheckout.targetUserId,
          targetServerId: pendingCheckout.targetServerId,
          promoCode: appliedPromoCode,
          referralCode: appliedReferralCode,
          pointsToRedeem,
          ...(pendingCheckout.guestContact
            ? {
                receiptEmail: pendingCheckout.guestContact.email,
                receiptWhatsapp: pendingCheckout.guestContact.whatsapp,
              }
            : {}),
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        order?: {
          id: string;
          payment?: { provider?: string; redirectUrl?: string | null };
        };
        accessToken?: string;
      };
      if (!response.ok || !data.order) {
        // Tutup dialog supaya pesan error di form terlihat.
        setConfirmOpen(false);
        setNotice(data.error ?? "Gagal membuat pembayaran.");
        return;
      }
      // Popup DOKU langsung dibuka dari gesture klik checkout (masih dalam
      // jendela transient activation) — tanpa halaman perantara.
      if (
        data.order.payment?.provider === "doku" &&
        data.order.payment.redirectUrl
      ) {
        const width = 520;
        const height = 780;
        const left = Math.max(0, Math.round((window.screen.width - width) / 2));
        const top = Math.max(0, Math.round((window.screen.height - height) / 2));
        window.open(
          data.order.payment.redirectUrl,
          "doku_payment",
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        );
      }
      const tokenParam = data.accessToken ? `?access_token=${data.accessToken}` : "";
      router.push(`/order/${encodeURIComponent(data.order.id)}${tokenParam}`);
    } catch {
      setConfirmOpen(false);
      setNotice("Tidak bisa menyiapkan pembayaran. Coba lagi.");
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
          {filteredGames.map((game) => {
            const artwork = artworkByGameId[game.id];
            return (
              <button className="game-card" key={game.id} type="button" onClick={() => chooseGame(game.id)}>
                <span
                  className="game-mark app-artwork"
                  style={{ background: game.accent, overflow: "hidden" }}
                >
                  {artwork ? (
                    <img
                      src={artwork.src}
                      alt={artwork.alt}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    game.initials
                  )}
                </span>
                <span className="game-copy">
                  <strong>{game.name}</strong>
                  <small>{game.category === "game" ? "Top up instan" : "Voucher digital"}</small>
                </span>
                <span className="card-arrow" aria-hidden="true">↗</span>
              </button>
            );
          })}
        </div>

        {filteredGames.length === 0 && (
          <div className="empty-state">Belum ada produk yang cocok dengan pencarianmu.</div>
        )}
      </section>

      <section className="topup-section" id="topup">
        {railPanel ? (
          <div className="topup-intro topup-intro-rail">{railPanel}</div>
        ) : (
          <div className="topup-intro">
            <span className="eyebrow">Checkout</span>
            <h2>Top up tanpa muter-muter.</h2>
            <p>
              Harga, promo, dan benefit referral dihitung otomatis, lalu
              disesuaikan dengan kode yang kamu pakai sebelum pembayaran dibuat.
            </p>
            <div className="trust-list">
              <span><b>01</b> Harga jelas</span>
              <span><b>02</b> Promo terukur</span>
              <span><b>03</b> Referral menguntungkan</span>
            </div>
          </div>
        )}

        <form className="order-card" onSubmit={submitOrder}>
          <div className="order-head">
            <div className="selected-product">
              <span
                className="selected-mark app-artwork"
                style={{ background: selectedGame.accent, overflow: "hidden" }}
              >
                {selectedGameArtwork ? (
                  <img
                    src={selectedGameArtwork.src}
                    alt={selectedGameArtwork.alt}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  selectedGame.initials
                )}
              </span>
              <div>
                <small>Produk dipilih</small>
                <strong>{selectedGame.name}</strong>
              </div>
            </div>
            <span className="preview-badge">Pembayaran aman</span>
          </div>

          <div
            className="form-block account-form-block"
            id="account-data"
            style={{ scrollMarginTop: "90px" }}
          >
            {accountError && (
              <div className="account-validation-error" role="alert" aria-live="assertive">
                <span className="account-validation-error-icon" aria-hidden="true">!</span>
                <span className="account-validation-error-copy">
                  <strong>Data akun belum lengkap</strong>
                  <small>{accountError}</small>
                </span>
              </div>
            )}
            <div className="form-label">
              <span className="step-number">1</span>
              <div>
                <strong>Data akun</strong>
                <small>{accountSchema.helper}</small>
              </div>
            </div>
            <div className={accountSchema.server ? "input-grid two" : "input-grid"}>
              <label>
                <span>{accountSchema.user.label}</span>
                <input
                  inputMode={accountSchema.user.inputMode}
                  maxLength={accountSchema.user.maxLength}
                  placeholder={accountSchema.user.placeholder}
                  value={userId}
                  onChange={(event) => {
                    setUserId(sanitizeAccountField(event.target.value, accountSchema.user));
                    setAccountError("");
                    setUsernameCheck({ status: "idle" });
                  }}
                />
              </label>
              {accountSchema.server && (
                <label>
                  <span>{accountSchema.server.label}</span>
                  {accountSchema.server.options ? (
                    <select
                      value={serverId}
                      onChange={(event) => {
                        setServerId(event.target.value);
                        setAccountError("");
                        setUsernameCheck({ status: "idle" });
                      }}
                    >
                      <option value="">{accountSchema.server.placeholder}</option>
                      {accountSchema.server.options.map((option) => (
                        <option
                          key={accountFieldOptionValue(option)}
                          value={accountFieldOptionValue(option)}
                        >
                          {accountFieldOptionLabel(option)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      inputMode={accountSchema.server.inputMode}
                      maxLength={accountSchema.server.maxLength}
                      placeholder={accountSchema.server.placeholder}
                      value={serverId}
                      onChange={(event) => {
                        setServerId(sanitizeAccountField(event.target.value, accountSchema.server!));
                        setAccountError("");
                        setUsernameCheck({ status: "idle" });
                      }}
                    />
                  )}
                </label>
              )}
            </div>

            {canCheckUsername && usernameCheck.status !== "idle" && (
              <div className="account-auto-check" aria-live="polite">
                <div className={`account-check-banner ${usernameCheck.status}`} role="status">
                  {usernameCheck.status === "loading" ? (
                    <>
                      <span className="account-check-icon" aria-hidden="true">↻</span>
                      <span className="account-check-copy">
                        <strong>Memeriksa akun...</strong>
                        <small>Sebentar, kami cek ID dan Zone kamu.</small>
                      </span>
                    </>
                  ) : usernameCheck.status === "success" ? (
                    <>
                      <span className="account-check-icon" aria-hidden="true">✓</span>
                      <span className="account-check-copy">
                        <span>Akun kamu <strong>{usernameCheck.nickname ?? "terverifikasi"}</strong>.</span>
                        <small>
                          {usernameCheck.region ? `${usernameCheck.region} · ` : ""}
                          Zone {usernameCheck.server ?? serverId}
                        </small>
                      </span>
                    </>
                  ) : usernameCheck.status === "pending" ? (
                    <>
                      <span className="account-check-icon" aria-hidden="true">…</span>
                      <span className="account-check-copy">
                        <strong>Masih diproses</strong>
                        <small>{usernameCheck.message}</small>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="account-check-icon" aria-hidden="true">!</span>
                      <span className="account-check-copy">
                        <strong>Belum terverifikasi</strong>
                        <small>{usernameCheck.message}</small>
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {viewerState === "guest" && (
            <div className="form-block guest-receipt-block" id="receipt-contact">
              {contactError && (
                <div className="account-validation-error" role="alert" aria-live="assertive">
                  <span className="account-validation-error-icon" aria-hidden="true">!</span>
                  <span className="account-validation-error-copy">
                    <strong>Kontak receipt belum lengkap</strong>
                    <small>{contactError}</small>
                  </span>
                </div>
              )}

              <div className="form-label">
                <span className="step-number">✉</span>
                <div>
                  <strong>Kontak receipt</strong>
                  <small>Karena kamu belum login, receipt transaksi akan menggunakan email dan WhatsApp ini.</small>
                </div>
              </div>

              <div className="input-grid two guest-receipt-fields">
                <label>
                  <span>Email</span>
                  <input
                    autoComplete="email"
                    inputMode="email"
                    type="email"
                    maxLength={254}
                    placeholder="nama@email.com"
                    value={guestEmail}
                    onChange={(event) => {
                      setGuestEmail(event.target.value);
                      setContactError("");
                    }}
                  />
                </label>

                <label>
                  <span>Nomor WhatsApp</span>
                  <input
                    autoComplete="tel"
                    inputMode="tel"
                    type="tel"
                    maxLength={20}
                    placeholder="081234567890"
                    value={guestWhatsapp}
                    onChange={(event) => {
                      setGuestWhatsapp(event.target.value);
                      setContactError("");
                    }}
                  />
                </label>
              </div>

              <p className="guest-receipt-note">
                Kontak ini hanya disimpan pada order untuk status dan receipt transaksi.
              </p>
            </div>
          )}

          <div className="form-block nominal-form-block nominal-form-grouped">
            <div className="form-label">
              <span className="step-number">2</span>
              <div><strong>Pilih nominal</strong><small>Semua nominal ditampilkan sekaligus dan dikelompokkan berdasarkan jenis produk.</small></div>
            </div>

            {bestDealItems.length > 0 && (
              <section
                className="nominal-section nominal-section-best-deals"
                aria-labelledby="best-deals-heading"
              >
                <div className="nominal-section-heading">
                  <div>
                    <strong id="best-deals-heading">
                      Best Deals
                      <span className="nominal-section-spark" aria-hidden="true">✦</span>
                    </strong>
                    <small>Lima nominal dengan margin rupiah tertinggi untuk {selectedGame.name}.</small>
                  </div>
                  <span>{bestDealItems.length} pilihan</span>
                </div>

                <div className="package-grid package-grid-v3">
                  {bestDealItems.map((item) =>
                    renderPackageCard(item, {
                      keyPrefix: "best-deal",
                      onSelect: () => selectPackage(item),
                    }),
                  )}
                </div>
              </section>
            )}

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
                    {section.items.map((item) =>
                      renderPackageCard(item, {
                        keyPrefix: section.id,
                        onSelect: () => selectPackage(item),
                      }),
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div
            className="form-block"
            ref={promoSectionRef}
            style={{ scrollMarginTop: "90px" }}
          >
            <div className="form-label">
              <span className="step-number">3</span>
              <div><strong>Promo & referral</strong><small>Kode promo dan referral otomatis dihitung dan langsung berlaku saat pembayaran.</small></div>
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
              {/* Hint login diletakkan di bawah kedua input supaya tidak menutupi
                  label field saat pertama kali dibuka. */}
              {viewerState === "guest" && (
                <p className="inline-message discount-login-hint">
                  💡 Kode promo & referral khusus pengguna login —{" "}
                  <a href="/login?next=%23topup">masuk</a> atau{" "}
                  <a href="/register?next=%23topup">daftar gratis</a> dulu untuk memakainya.
                </p>
              )}
            </div>

            {promoMessage && <p className="inline-message">{promoMessage}</p>}
            {promoEndsAt && appliedPromoCode && promoCountdownLabel(promoEndsAt, promoCountdownNow) && (
              <p className="inline-message promo-countdown">
                ⏳ Promo berakhir dalam <b>{promoCountdownLabel(promoEndsAt, promoCountdownNow)}</b>
              </p>
            )}
            {referralMessage && <p className="inline-message referral-message">{referralMessage}</p>}
            {pricingError && <p className="inline-message warning">{pricingError}</p>}

            {pricing.referralCode && pricing.referralDiscount > 0 && (
              <p className="referral-active">
                Referral {pricing.referralCode} aktif · kamu hemat {formatIDR(pricing.referralDiscount)}.
                {pricing.referralDiscountCapped ? " Benefit disesuaikan otomatis agar transaksi tetap aman." : ""}
              </p>
            )}
            {(appliedPromoCode || appliedReferralCode) && pricing.rejectionReason && (
              <p className="inline-message warning">{pricing.rejectionReason}</p>
            )}
          </div>

          <div className="form-block points-checkout-block">
            <div className="form-label">
              <span className="step-number">N+</span>
              <div>
                <strong>Nambah Points</strong>
                <small>
                  {viewerState === "authenticated"
                    ? "Gunakan points sebagai potongan. Points baru didapat setelah transaksi berhasil."
                    : "Login untuk mengumpulkan dan menggunakan Nambah Points."}
                </small>
              </div>
            </div>

            {viewerState === "authenticated" ? (
              pointsLoading ? (
                <div className="points-checkout-loading">Memuat saldo points...</div>
              ) : pointsSummary ? (
                <div className="points-checkout-card">
                  <div className="points-checkout-balance">
                    <div>
                      <small>Points tersedia</small>
                      <strong>{pointsSummary.available.toLocaleString("id-ID")} pts</strong>
                      <span>
                        ≈ {formatIDR(pointsSummary.available * pointsSummary.rules.pointValueIdr)}
                      </span>
                    </div>
                    <div className="points-earn-preview">
                      <small>Estimasi dari order ini</small>
                      <strong>+{pricing.pointsEarned.toLocaleString("id-ID")} pts</strong>
                      <span>masuk setelah status success</span>
                    </div>
                  </div>

                  {maxPointsForOrder >= pointsSummary.rules.minimumRedeem ? (
                    <>
                      <div className="points-redeem-head">
                        <span>Gunakan</span>
                        <strong>
                          {pointsToRedeem.toLocaleString("id-ID")} pts
                          {pointsToRedeem > 0
                            ? " · -" +
                              formatIDR(
                                pointsToRedeem *
                                  pointsSummary.rules.pointValueIdr,
                              )
                            : ""}
                        </strong>
                      </div>
                      <input
                        className="points-range"
                        type="range"
                        min={0}
                        max={maxPointsForOrder}
                        step={pointsSummary.rules.redeemStep}
                        value={Math.min(pointsToRedeem, maxPointsForOrder)}
                        onChange={(event) => {
                          setPointsError("");
                          setPointsToRedeem(Number(event.target.value));
                        }}
                        aria-label="Nambah Points yang digunakan"
                      />
                      <div className="points-redeem-actions">
                        <span>
                          Maks. {maxPointsForOrder.toLocaleString("id-ID")} pts · {Math.round(pointsSummary.rules.maxRedeemRate * 100)}% subtotal
                        </span>
                        <button
                          type="button"
                          onClick={() => setPointsToRedeem(maxPointsForOrder)}
                        >
                          Pakai maksimal
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="points-checkout-note">
                      Saldo belum mencapai minimum {pointsSummary.rules.minimumRedeem} points atau margin transaksi belum memungkinkan redemption.
                    </p>
                  )}
                </div>
              ) : (
                <p className="inline-message warning">
                  {pointsError || "Nambah Points belum dapat dimuat."}
                </p>
              )
            ) : (
              <div className="points-guest-callout">
                <span>N+</span>
                <p>
                  Setiap Rp2.000 eligible spend menghasilkan 1 point. Masuk ke akun Nambah sebelum checkout untuk mulai mengumpulkan points.
                </p>
              </div>
            )}
            {pointsError && pointsSummary && (
              <p className="inline-message warning">{pointsError}</p>
            )}
          </div>

          <div className="checkout-rail">
          <div className="form-block">
            <div className="form-label">
              <span className="step-number">4</span>
              <div><strong>Metode pembayaran</strong><small>Pilih metode yang paling nyaman. Pembayaran diverifikasi otomatis sebelum pesanan diproses.</small></div>
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
            {pricing.pointsDiscount > 0 && (
              <div className="summary-line points-benefit"><span>Nambah Points · {pricing.pointsRedeemed.toLocaleString("id-ID")} pts</span><strong>-{formatIDR(pricing.pointsDiscount)}</strong></div>
            )}
            {viewerState === "authenticated" && pricing.pointsEarned > 0 && (
              <div className="summary-line points-earn"><span>Points setelah success</span><strong>+{pricing.pointsEarned.toLocaleString("id-ID")} pts</strong></div>
            )}
            <div className="summary-line">
              <span>Biaya pembayaran</span>
              <strong>{pricing.customerPaymentFee === 0 ? "Rp0 (MVP)" : formatIDR(pricing.customerPaymentFee)}</strong>
            </div>
            <div className="summary-total"><span>Total</span><strong>{pricingLoading ? "Menghitung..." : formatIDR(pricing.finalPrice)}</strong></div>
          </div>

          <button className="primary-button full" disabled={isSubmitting || pricingLoading || Boolean(pricingError)} type="submit">
            {pricingLoading ? "Menghitung harga..." : "Lanjutkan pembayaran"} <span aria-hidden="true">→</span>
          </button>
          </div>
          {notice && <p className="form-notice" role="status">{notice}</p>}

          {confirmOpen && pendingCheckout && (
            <div
              className="checkout-confirm-backdrop"
              role="presentation"
              onClick={() => {
                if (!isSubmitting) setConfirmOpen(false);
              }}
            >
              <section
                className="checkout-confirm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="checkout-confirm-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="checkout-confirm-head">
                  <span className="checkout-confirm-head-icon" aria-hidden="true">
                    ✓
                  </span>
                  <div className="checkout-confirm-head-copy">
                    <h3 id="checkout-confirm-title">Periksa transaksi kamu</h3>
                    <p>Pastikan data tujuan sudah benar sebelum melanjutkan ke pembayaran.</p>
                  </div>
                </header>

                <div className="checkout-confirm-list">
                  <div className="checkout-confirm-row">
                    <span>Produk</span>
                    <strong>{selectedGame.name} · {selectedPackage.label}</strong>
                  </div>
                  <div className="checkout-confirm-row checkout-confirm-row-accent">
                    <span>User ID</span>
                    <strong>{pendingCheckout.targetUserId}</strong>
                  </div>
                  {pendingCheckout.targetServerId && (
                    <div className="checkout-confirm-row">
                      <span>Server / Zone</span>
                      <strong>{pendingCheckout.targetServerId}</strong>
                    </div>
                  )}
                  <div className="checkout-confirm-row">
                    <span>Metode pembayaran</span>
                    <strong>{paymentMethod.name}</strong>
                  </div>
                  <div className="checkout-confirm-row">
                    <span>Tujuan receipt</span>
                    <strong>
                      {pendingCheckout.guestContact?.email ?? viewerEmail ?? "Email akun"}
                    </strong>
                  </div>
                  {pendingCheckout.guestContact?.whatsapp && (
                    <div className="checkout-confirm-row">
                      <span>WhatsApp</span>
                      <strong>{pendingCheckout.guestContact.whatsapp}</strong>
                    </div>
                  )}
                  {appliedPromoCode && (
                    <div className="checkout-confirm-row">
                      <span>Kode promo</span>
                      <strong>{appliedPromoCode}</strong>
                    </div>
                  )}
                  {appliedReferralCode && (
                    <div className="checkout-confirm-row">
                      <span>Kode referral</span>
                      <strong>{appliedReferralCode}</strong>
                    </div>
                  )}
                  {pointsToRedeem > 0 && (
                    <div className="checkout-confirm-row">
                      <span>Nambah Points</span>
                      <strong>{pointsToRedeem.toLocaleString("id-ID")} pts</strong>
                    </div>
                  )}
                </div>

                <div className="checkout-confirm-totals">
                  <div className="summary-line">
                    <span>Harga Nambah</span>
                    <strong>{formatIDR(pricing.sellingPrice)}</strong>
                  </div>
                  {pricing.promotionDiscount > 0 && (
                    <div className="summary-line discount"><span>Promo {pricing.promoCode}</span><strong>-{formatIDR(pricing.promotionDiscount)}</strong></div>
                  )}
                  {pricing.referralDiscount > 0 && (
                    <div className="summary-line referral-benefit"><span>Benefit referral {pricing.referralCode}</span><strong>-{formatIDR(pricing.referralDiscount)}</strong></div>
                  )}
                  {pricing.pointsDiscount > 0 && (
                    <div className="summary-line points-benefit"><span>Nambah Points</span><strong>-{formatIDR(pricing.pointsDiscount)}</strong></div>
                  )}
                  <div className="summary-line">
                    <span>Biaya pembayaran</span>
                    <strong>{pricing.customerPaymentFee === 0 ? "Rp0 (MVP)" : formatIDR(pricing.customerPaymentFee)}</strong>
                  </div>
                  <div className="summary-total"><span>Total dibayar</span><strong>{formatIDR(pricing.finalPrice)}</strong></div>
                </div>

                <footer className="checkout-confirm-actions">
                  <button
                    ref={confirmCloseRef}
                    type="button"
                    className="checkout-confirm-cancel"
                    disabled={isSubmitting}
                    onClick={() => setConfirmOpen(false)}
                  >
                    Kembali
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={isSubmitting}
                    onClick={() => void confirmCheckout()}
                  >
                    {isSubmitting ? "Membuat pembayaran..." : "Konfirmasi & bayar"} <span aria-hidden="true">→</span>
                  </button>
                </footer>
              </section>
            </div>
          )}
        </form>
      </section>
    </>
  );
}
