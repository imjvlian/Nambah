"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";
import AdminCatalogTools from "@/components/AdminCatalogTools";

type AdminSection =
  | "overview"
  | "orders"
  | "catalog"
  | "supplier"
  | "receipts"
  | "points"
  | "promotions"
  | "affiliates"
  | "users"
  | "system";

type AdminSessionUser = {
  email: string;
  displayName: string;
};

type CatalogProduct = {
  id: string;
  gameId: string;
  gameName: string;
  gameShortName: string;
  label: string;
  note: string | null;
  sellingPrice: number;
  referencePrice: number;
  active: boolean;
  sortOrder: number;
  supplier: {
    mapped: boolean;
    sku: string | null;
    cost: number | null;
    active: boolean;
    lastSyncedAt: string | null;
    ready: boolean;
  };
};

type CatalogPayload = {
  stats: {
    total: number;
    active: number;
    mapped: number;
    ready: number;
    unmapped: number;
  };
  balance: {
    balance: number;
    reservedBalance: number;
    availableBalance: number;
    checkedAt: string | null;
  };
  games: Array<{
    id: string;
    name: string;
    shortName: string;
    active: boolean;
  }>;
  products: CatalogProduct[];
};

type DraftProduct = {
  label: string;
  note: string;
  sellingPrice: string;
  referencePrice: string;
  active: boolean;
  supplierSku: string;
};

type OverviewPayload = {
  generatedAt: string;
  stats: {
    ordersToday: number | null;
    successToday: number | null;
    pendingPayment: number | null;
    processing: number | null;
    failed: number | null;
    receiptsSent: number | null;
    receiptsFailed: number | null;
    activePromotions: number | null;
    activeAffiliates: number | null;
    supplierPending: number | null;
    receiptSending: number | null;
  };
  finance: {
    gmvToday: number;
    supplierBalance: number;
    reservedBalance: number;
    availableBalance: number;
    balanceCheckedAt: string | null;
  };
  recentOrders: AdminOrder[];
  system: {
    flowTest: boolean;
    fulfillmentMode: string;
    services: Array<{
      id: string;
      name: string;
      ready: boolean;
      detail: string;
      state: "live" | "test" | "planned" | "attention";
    }>;
  };
};

type AdminOrder = {
  id: string;
  status: string;
  finalPrice: number;
  targetUserId: string;
  targetServerId: string | null;
  receiptEmail?: string | null;
  customerUserId?: string | null;
  gameName: string;
  packageLabel: string;
  paymentName?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
  fulfilledAt?: string | null;
};

type ReceiptRow = {
  id: number;
  orderId: string;
  channel: string;
  recipient: string;
  provider: string;
  status: string;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminPointsPayload = {
  stats: {
    accounts: number;
    outstanding: number;
    reserved: number;
    available: number;
    lifetimeEarned: number;
    lifetimeRedeemed: number;
  };
  rules: {
    pointValueIdr: number;
    earnEveryIdr: number;
    minimumRedeem: number;
    redeemStep: number;
    maxRedeemRate: number;
  };
  accounts: Array<{
    userId: string;
    balance: number;
    reserved: number;
    available: number;
    lifetimeEarned: number;
    lifetimeRedeemed: number;
    updatedAt: string;
  }>;
  ledger: Array<{
    id: number;
    userId: string;
    orderId: string | null;
    type: string;
    pointsDelta: number;
    reservedDelta: number;
    balanceAfter: number;
    reservedAfter: number;
    note: string | null;
    createdAt: string;
  }>;
};

type AffiliatePayload = {
  stats: {
    affiliates: number;
    active: number;
    pending: number;
    available: number;
    withdrawn: number;
    cancelled: number;
  };
  affiliates: Array<{
    code: string;
    displayName: string;
    commissionRate: number;
    status: string;
    createdAt: string;
  }>;
  commissions: Array<{
    id: number;
    affiliateCode: string;
    orderId: string;
    baseProfit: number;
    rate: number;
    amount: number;
    status: string;
    availableAt: string | null;
    createdAt: string;
  }>;
};

type PromotionPayload = {
  promotions: Array<{
    code: string;
    name: string;
    type: "flat" | "percentage";
    value: number;
    minimumOrder: number;
    maxDiscount: number | null;
    stackableWithReferral: boolean;
    startsAt: string | null;
    endsAt: string | null;
    quota: number | null;
    quotaPerUser: number | null;
    active: boolean;
    productIds: string[];
    reserved: number;
    redeemed: number;
  }>;
};

type AdminOrderDetail = {
  order: Record<string, unknown>;
  payments: Array<Record<string, unknown>>;
  supplierTransactions: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  commissions: Array<Record<string, unknown>>;
  points: Array<Record<string, unknown>>;
  promotionRedemptions: Array<Record<string, unknown>>;
};

type AdminUsersPayload = {
  users: Array<{
    userId: string;
    displayName: string | null;
    whatsapp: string | null;
    preferredReceiptChannel: string;
    profileUpdatedAt: string | null;
    orders: number;
    success: number;
    spend: number;
    lastOrderAt: string | null;
  }>;
};

type BootstrapResult = {
  summary?: {
    autoMapped?: number;
    suggested?: number;
    unmapped?: number;
  };
};

const NAV: Array<{
  id: AdminSection;
  label: string;
  short: string;
}> = [
  { id: "overview", label: "Overview", short: "OV" },
  { id: "orders", label: "Orders", short: "OR" },
  { id: "catalog", label: "Catalog", short: "CA" },
  { id: "supplier", label: "Supplier", short: "SU" },
  { id: "receipts", label: "Receipts", short: "RE" },
  { id: "points", label: "Nambah Points", short: "NP" },
  { id: "promotions", label: "Promotions", short: "PR" },
  { id: "affiliates", label: "Affiliates", short: "AF" },
  { id: "users", label: "Users", short: "US" },
  { id: "system", label: "System", short: "SY" },
];

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Pending payment",
  paid: "Paid",
  processing: "Processing",
  success: "Success",
  failed: "Failed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function numberOrDash(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : String(value);
}

function draftFromProduct(product: CatalogProduct): DraftProduct {
  return {
    label: product.label,
    note: product.note ?? "",
    sellingPrice: String(product.sellingPrice),
    referencePrice: String(product.referencePrice),
    active: product.active,
    supplierSku: product.supplier.sku ?? "",
  };
}

function SectionHead({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="acc-section-head">
      <div>
        <span className="acc-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  );
}

function RoadmapCard({
  title,
  status,
  copy,
}: {
  title: string;
  status: "live" | "foundation" | "planned";
  copy: string;
}) {
  return (
    <article className="acc-roadmap-card">
      <div>
        <strong>{title}</strong>
        <span className={`acc-roadmap-status ${status}`}>
          {status === "live"
            ? "Live"
            : status === "foundation"
              ? "Foundation"
              : "Planned"}
        </span>
      </div>
      <p>{copy}</p>
    </article>
  );
}

export default function AdminDashboard() {
  const [authState, setAuthState] = useState<
    "loading" | "guest" | "forbidden" | "ready"
  >("loading");
  const [section, setSection] = useState<AdminSection>("overview");
  const [adminUser, setAdminUser] = useState<AdminSessionUser | null>(null);
  const [adminRole, setAdminRole] = useState("");
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [pointsData, setPointsData] = useState<AdminPointsPayload | null>(null);
  const [affiliateData, setAffiliateData] = useState<AffiliatePayload | null>(null);
  const [promotionData, setPromotionData] = useState<PromotionPayload | null>(null);
  const [orderDetail, setOrderDetail] = useState<AdminOrderDetail | null>(null);
  const [usersData, setUsersData] = useState<AdminUsersPayload | null>(null);
  const [promoDraft, setPromoDraft] = useState({
    code: "",
    name: "",
    type: "flat" as "flat" | "percentage",
    value: "1000",
    minimumOrder: "20000",
    maxDiscount: "",
    quota: "",
    quotaPerUser: "",
  });
  const [drafts, setDrafts] = useState<Record<string, DraftProduct>>({});
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const [mappingFilter, setMappingFilter] = useState("all");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  function hydrateDrafts(payload: CatalogPayload) {
    setDrafts(
      Object.fromEntries(
        payload.products.map((product) => [
          product.id,
          draftFromProduct(product),
        ]),
      ),
    );
  }

  async function loadOverview() {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (response.status === 401) {
      setAuthState("guest");
      return;
    }
    const data = (await response.json()) as OverviewPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Overview admin gagal dimuat.");
    }
    setOverview(data);
  }

  async function loadCatalog() {
    const response = await fetch("/api/admin/catalog", { cache: "no-store" });
    if (response.status === 401) {
      setAuthState("guest");
      return;
    }
    const data = (await response.json()) as CatalogPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Katalog admin gagal dimuat.");
    }
    setCatalog(data);
    hydrateDrafts(data);
  }

  async function loadOrders() {
    const response = await fetch("/api/admin/orders", { cache: "no-store" });
    const data = (await response.json()) as {
      orders?: AdminOrder[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "Order gagal dimuat.");
    setOrders(data.orders ?? []);
  }

  async function loadReceipts() {
    const response = await fetch("/api/admin/receipts", { cache: "no-store" });
    const data = (await response.json()) as {
      receipts?: ReceiptRow[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "Receipt gagal dimuat.");
    setReceipts(data.receipts ?? []);
  }

  async function loadPoints() {
    const response = await fetch("/api/admin/points", { cache: "no-store" });
    const data = (await response.json()) as AdminPointsPayload & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Nambah Points gagal dimuat.");
    }
    setPointsData(data);
  }

  async function loadAffiliates() {
    const response = await fetch("/api/admin/affiliates", { cache: "no-store" });
    const data = (await response.json()) as AffiliatePayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Affiliate ledger gagal dimuat.");
    }
    setAffiliateData(data);
  }

  async function loadPromotions() {
    const response = await fetch("/api/admin/promotions", { cache: "no-store" });
    const data = (await response.json()) as PromotionPayload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Promo gagal dimuat.");
    setPromotionData(data);
  }

  async function createPromotion() {
    setBusy("promotion-create");
    setNotice("");
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: promoDraft.code,
          name: promoDraft.name,
          type: promoDraft.type,
          value: Number(promoDraft.value),
          minimumOrder: Number(promoDraft.minimumOrder),
          maxDiscount: promoDraft.maxDiscount || null,
          quota: promoDraft.quota || null,
          quotaPerUser: promoDraft.quotaPerUser || null,
          active: true,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Promo gagal dibuat.");
      setPromoDraft({
        code: "",
        name: "",
        type: "flat",
        value: "1000",
        minimumOrder: "20000",
        maxDiscount: "",
        quota: "",
        quotaPerUser: "",
      });
      await Promise.all([loadPromotions(), loadOverview()]);
      setNotice("Promo berhasil dibuat.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Promo gagal dibuat.");
    } finally {
      setBusy("");
    }
  }

  async function togglePromotion(code: string, active: boolean) {
    setBusy("promotion:" + code);
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, active }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Promo gagal diperbarui.");
      await Promise.all([loadPromotions(), loadOverview()]);
      setNotice(code + (active ? " diaktifkan." : " dinonaktifkan."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Promo gagal diperbarui.");
    } finally {
      setBusy("");
    }
  }

  async function inspectOrder(orderId: string) {
    setBusy("inspect:" + orderId);
    setNotice("");
    try {
      const response = await fetch(
        "/api/admin/orders/" + encodeURIComponent(orderId),
        { cache: "no-store" },
      );
      const data = (await response.json()) as AdminOrderDetail & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Detail order gagal dimuat.");
      }
      setOrderDetail(data);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Detail order gagal dimuat.",
      );
    } finally {
      setBusy("");
    }
  }

  async function retryAdminReceipt(orderId: string) {
    setBusy("receipt:" + orderId);
    setNotice("");
    try {
      const response = await fetch(
        "/api/admin/orders/" + encodeURIComponent(orderId) + "/receipt",
        { method: "POST" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Receipt gagal dikirim ulang.");
      }
      await inspectOrder(orderId);
      setNotice("Receipt diproses ulang.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Receipt gagal dikirim ulang.",
      );
    } finally {
      setBusy("");
    }
  }

  async function loadUsers() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const data = (await response.json()) as AdminUsersPayload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Data user gagal dimuat.");
    setUsersData(data);
  }

  async function runReconciliation() {
    setBusy("reconciliation");
    setNotice("");
    try {
      const response = await fetch("/api/admin/reconciliation", {
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: string;
        orders?: {
          checked: number;
          recovered: number;
          pending: number;
          failed: number;
        };
        supplier?: {
          checked: number;
          applied: number;
          stillPending: number;
          skipped: number;
          failed: number;
        };
        receipts?: {
          retried: number;
          sent: number;
          stillFailed: number;
          staleSending: number;
        };
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Reconciliation gagal.");
      }

      await Promise.all([loadOverview(), loadOrders(), loadReceipts()]);
      setNotice(
        `Reconciliation selesai: ${data.orders?.recovered ?? 0} order pulih, ${data.supplier?.applied ?? 0} status supplier diterapkan, ${data.receipts?.sent ?? 0} receipt terkirim ulang, ${data.receipts?.staleSending ?? 0} receipt sending perlu review.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Reconciliation gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  async function refreshCurrent() {
    setBusy("refresh");
    setNotice("");
    try {
      await loadOverview();
      if (section === "orders") await loadOrders();
      if (section === "catalog" || section === "supplier") await loadCatalog();
      if (section === "receipts") await loadReceipts();
      if (section === "points") await loadPoints();
      if (section === "affiliates") await loadAffiliates();
      if (section === "promotions") await loadPromotions();
      if (section === "users") await loadUsers();
      setNotice("Data admin diperbarui.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Refresh admin gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          configured?: boolean;
          authenticated?: boolean;
          forbidden?: boolean;
          role?: string;
          user?: AdminSessionUser | null;
          error?: string;
        };
        if (!mounted) return;

        if (!response.ok || !data.configured) {
          setAuthState("guest");
          setNotice(data.error ?? "Admin session belum dikonfigurasi.");
          return;
        }

        if (data.forbidden) {
          setAdminUser(data.user ?? null);
          setAuthState("forbidden");
          return;
        }

        if (!data.authenticated) {
          setAuthState("guest");
          return;
        }

        setAdminUser(data.user ?? null);
        setAdminRole(data.role ?? "admin");

        await Promise.all([loadOverview(), loadCatalog()]);
        if (mounted) setAuthState("ready");
      } catch (error) {
        if (mounted) {
          setAuthState("guest");
          setNotice(
            error instanceof Error
              ? error.message
              : "Dashboard admin belum dapat dihubungi.",
          );
        }
      }
    }

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;

    if (section === "orders" && orders.length === 0) {
      void loadOrders().catch((error) =>
        setNotice(error instanceof Error ? error.message : "Order gagal dimuat."),
      );
    }
    if (section === "receipts" && receipts.length === 0) {
      void loadReceipts().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Receipt gagal dimuat.",
        ),
      );
    }
    if (section === "points" && !pointsData) {
      void loadPoints().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Nambah Points gagal dimuat.",
        ),
      );
    }
    if (section === "affiliates" && !affiliateData) {
      void loadAffiliates().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Affiliate ledger gagal dimuat.",
        ),
      );
    }
    if (section === "promotions" && !promotionData) {
      void loadPromotions().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Promo gagal dimuat.",
        ),
      );
    }
    if (section === "users" && !usersData) {
      void loadUsers().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Data user gagal dimuat.",
        ),
      );
    }
  }, [section, authState, orders.length, receipts.length, pointsData, affiliateData, promotionData, usersData]);

  async function logout() {
    setBusy("logout");
    try {
      await Promise.all([
        fetch("/api/admin/session", { method: "DELETE" }),
        fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
        }),
      ]);
    } finally {
      window.location.replace("/login?next=%2Fadmin");
    }
  }

  function updateDraft(productId: string, patch: Partial<DraftProduct>) {
    setDrafts((current) => ({
      ...current,
      [productId]: {
        ...current[productId]!,
        ...patch,
      },
    }));
  }

  async function saveProduct(product: CatalogProduct) {
    const draft = drafts[product.id];
    if (!draft) return;

    const sellingPrice = Number(draft.sellingPrice);
    const referencePrice = Number(draft.referencePrice);
    const nextSku = draft.supplierSku.trim();
    const currentSku = product.supplier.sku ?? "";

    if (!Number.isInteger(sellingPrice) || sellingPrice <= 0) {
      setNotice(`${product.id}: harga jual tidak valid.`);
      return;
    }
    if (!Number.isInteger(referencePrice) || referencePrice < sellingPrice) {
      setNotice(`${product.id}: reference price harus >= harga jual.`);
      return;
    }
    if (!nextSku && currentSku) {
      setNotice(
        `${product.id}: SKU lama tidak boleh dikosongkan dari editor ini.`,
      );
      return;
    }

    setBusy(`save:${product.id}`);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/catalog/${encodeURIComponent(product.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: draft.label,
            note: draft.note || null,
            sellingPrice,
            referencePrice,
            active: draft.active,
          }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Produk gagal disimpan.");
      }

      if (nextSku && nextSku.toUpperCase() !== currentSku.toUpperCase()) {
        const mappingResponse = await fetch("/api/admin/digiflazz/map-sku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: product.id,
            supplierSku: nextSku,
          }),
        });
        const mapping = (await mappingResponse.json()) as { error?: string };
        if (!mappingResponse.ok) {
          throw new Error(mapping.error ?? "Mapping SKU gagal.");
        }
      }

      await Promise.all([loadCatalog(), loadOverview()]);
      setNotice(`${product.id} berhasil diperbarui.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Produk gagal diperbarui.",
      );
    } finally {
      setBusy("");
    }
  }

  async function runBootstrap(apply: boolean) {
    setBusy(apply ? "bootstrap-apply" : "bootstrap-scan");
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply, remap: false }),
      });
      const result = (await response.json()) as BootstrapResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Bootstrap Digiflazz gagal.");
      }

      if (apply) await Promise.all([loadCatalog(), loadOverview()]);
      setNotice(
        apply
          ? `Auto-map selesai. ${result.summary?.autoMapped ?? 0} produk dipetakan, ${result.summary?.unmapped ?? 0} belum mapped.`
          : `Scan selesai. ${result.summary?.suggested ?? 0} kandidat aman, ${result.summary?.unmapped ?? 0} belum cocok.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Bootstrap Digiflazz gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  async function syncPrices() {
    setBusy("sync");
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const result = (await response.json()) as {
        error?: string;
        summary?: {
          found?: number;
          costChanged?: number;
          missing?: number;
        };
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Sinkronisasi harga gagal.");
      }

      await Promise.all([loadCatalog(), loadOverview()]);
      setNotice(
        `Sync selesai. ${result.summary?.found ?? 0} SKU ditemukan, ${result.summary?.costChanged ?? 0} harga berubah, ${result.summary?.missing ?? 0} missing.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Sinkronisasi harga gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  async function checkBalance() {
    setBusy("balance");
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: false }),
      });
      const result = (await response.json()) as {
        error?: string;
        availableBalance?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "Cek saldo gagal.");

      await Promise.all([loadCatalog(), loadOverview()]);
      setNotice(
        `Saldo diperbarui: ${formatIDR(result.availableBalance ?? 0)} tersedia.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Cek saldo gagal.");
    } finally {
      setBusy("");
    }
  }

  const filteredProducts = useMemo(() => {
    if (!catalog) return [];
    const keyword = query.trim().toLowerCase();

    return catalog.products.filter((product) => {
      if (gameFilter !== "all" && product.gameId !== gameFilter) return false;
      if (mappingFilter === "mapped" && !product.supplier.mapped) return false;
      if (mappingFilter === "unmapped" && product.supplier.mapped) return false;
      if (mappingFilter === "ready" && !product.supplier.ready) return false;
      if (!keyword) return true;

      return `${product.id} ${product.gameName} ${product.label} ${product.supplier.sku ?? ""}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [catalog, query, gameFilter, mappingFilter]);

  const filteredOrders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (
        orderStatusFilter !== "all" &&
        order.status !== orderStatusFilter
      ) {
        return false;
      }
      if (!keyword) return true;
      return `${order.id} ${order.gameName} ${order.packageLabel} ${order.targetUserId}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [orders, orderStatusFilter, query]);

  if (authState === "loading") {
    return (
      <main className="admin-shell">
        <div className="admin-loading">Memuat Nambah Control Center...</div>
      </main>
    );
  }

  if (authState === "guest") {
    return (
      <main className="admin-shell admin-login-shell">
        <section className="admin-login-card">
          <Link className="brand" href="/">
            <span className="brand-mark">N+</span>
            <span>Nambah</span>
          </Link>
          <span className="admin-kicker">Admin account</span>
          <h1>Masuk dengan akun admin.</h1>
          <p>
            Control Center memakai akun Nambah dengan role admin atau
            superadmin.
          </p>
          <Link
            className="primary-button full admin-account-login"
            href="/login?next=%2Fadmin"
          >
            Masuk ke akun admin <span>→</span>
          </Link>
          {notice && <p className="admin-notice error">{notice}</p>}
        </section>
      </main>
    );
  }

  if (authState === "forbidden") {
    return (
      <main className="admin-shell admin-login-shell">
        <section className="admin-login-card">
          <Link className="brand" href="/">
            <span className="brand-mark">N+</span>
            <span>Nambah</span>
          </Link>
          <span className="admin-kicker">Akses ditolak</span>
          <h1>Akun ini bukan admin.</h1>
          <p>
            {adminUser?.email
              ? `${adminUser.email} sudah login tetapi belum memiliki role admin.`
              : "Akun ini belum memiliki role admin."}
          </p>
          <button
            type="button"
            className="admin-secondary-button"
            onClick={() => void logout()}
          >
            Keluar & ganti akun
          </button>
        </section>
      </main>
    );
  }

  const activeNav = NAV.find((item) => item.id === section) ?? NAV[0]!;

  return (
    <main className="acc-page">
      <aside className="acc-sidebar">
        <Link className="acc-brand" href="/">
          <span className="brand-mark">N+</span>
          <span>
            <b>Nambah</b>
            <small>Control Center</small>
          </span>
        </Link>

        <nav className="acc-nav" aria-label="Admin navigation">
          {NAV.map((item) => (
            <button
              type="button"
              key={item.id}
              className={section === item.id ? "active" : ""}
              onClick={() => {
                setSection(item.id);
                setQuery("");
                setNotice("");
              }}
            >
              <span>{item.short}</span>
              <b>{item.label}</b>
            </button>
          ))}
        </nav>

        <div className="acc-sidebar-foot">
          {adminUser && (
            <div className="acc-admin-user">
              <span>
                {adminUser.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{adminUser.displayName}</strong>
                <small>{adminRole || "admin"}</small>
              </div>
            </div>
          )}
          <button type="button" onClick={() => void logout()}>
            Keluar
          </button>
        </div>
      </aside>

      <section className="acc-workspace">
        <header className="acc-topbar">
          <div>
            <small>Admin / {activeNav.label}</small>
            <strong>{activeNav.label}</strong>
          </div>
          <div className="acc-topbar-actions">
            {overview?.system.flowTest && (
              <span className="acc-env-badge">FLOW TEST</span>
            )}
            <button
              type="button"
              onClick={() => void refreshCurrent()}
              disabled={busy === "refresh"}
            >
              {busy === "refresh" ? "Refreshing..." : "Refresh"}
            </button>
            <Link href="/" target="_blank">
              Website ↗
            </Link>
          </div>
        </header>

        {notice && (
          <div className="acc-global-notice" role="status">
            {notice}
          </div>
        )}

        <div className="acc-content">
          {section === "overview" && overview && (
            <>
              <section className="acc-hero">
                <div>
                  <span className="acc-eyebrow">Operations overview</span>
                  <h1>Semua yang penting, satu layar.</h1>
                  <p>
                    Pantau order, supplier, receipt, pricing, dan kesiapan
                    sistem tanpa membuka database satu per satu.
                  </p>
                </div>
                <div className="acc-balance">
                  <small>Saldo Digiflazz tersedia</small>
                  <strong>{formatIDR(overview.finance.availableBalance)}</strong>
                  <span>
                    Update {formatTime(overview.finance.balanceCheckedAt)}
                  </span>
                </div>
              </section>

              <section className="acc-metrics">
                <article>
                  <small>Order hari ini</small>
                  <strong>{numberOrDash(overview.stats.ordersToday)}</strong>
                  <span>{numberOrDash(overview.stats.successToday)} sukses</span>
                </article>
                <article>
                  <small>GMV hari ini</small>
                  <strong>{formatIDR(overview.finance.gmvToday)}</strong>
                  <span>Order berstatus success</span>
                </article>
                <article>
                  <small>Processing</small>
                  <strong>{numberOrDash(overview.stats.processing)}</strong>
                  <span>{numberOrDash(overview.stats.pendingPayment)} menunggu bayar</span>
                </article>
                <article>
                  <small>Receipt gagal</small>
                  <strong>{numberOrDash(overview.stats.receiptsFailed)}</strong>
                  <span>{numberOrDash(overview.stats.receiptsSent)} terkirim</span>
                </article>
              </section>

              <section className="acc-grid-two">
                <div className="acc-panel">
                  <SectionHead
                    eyebrow="Recent activity"
                    title="Order terbaru"
                    copy="10 transaksi terakhir yang masuk ke sistem."
                    action={
                      <button
                        className="acc-inline-button"
                        type="button"
                        onClick={() => setSection("orders")}
                      >
                        Lihat semua →
                      </button>
                    }
                  />
                  <div className="acc-order-list">
                    {overview.recentOrders.map((order) => (
                      <div className="acc-order-row" key={order.id}>
                        <div>
                          <small>{order.id}</small>
                          <strong>{order.gameName}</strong>
                          <span>{order.packageLabel}</span>
                        </div>
                        <b>{formatIDR(order.finalPrice)}</b>
                        <span className={`acc-status ${order.status}`}>
                          {STATUS_LABEL[order.status] ?? order.status}
                        </span>
                      </div>
                    ))}
                    {overview.recentOrders.length === 0 && (
                      <div className="acc-empty">Belum ada order.</div>
                    )}
                  </div>
                </div>

                <div className="acc-panel">
                  <SectionHead
                    eyebrow="System health"
                    title="Integrasi"
                    copy="Status konfigurasi service utama Nambah."
                  />
                  <div className="acc-service-list">
                    {overview.system.services.map((service) => (
                      <div className="acc-service-row" key={service.id}>
                        <span className={`acc-health ${service.state}`} />
                        <div>
                          <strong>{service.name}</strong>
                          <small>{service.detail}</small>
                        </div>
                        <b>{service.state}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="acc-panel">
                <SectionHead
                  eyebrow="Roadmap"
                  title="Modul Nambah"
                  copy="Fitur aktif dan pekerjaan yang sudah ada dalam roadmap production-ready."
                />
                <div className="acc-roadmap-grid">
                  <RoadmapCard
                    title="Payment verification"
                    status="live"
                    copy="Midtrans webhook/status API, gross amount validation, dan anti-downgrade status."
                  />
                  <RoadmapCard
                    title="Fulfillment orchestration"
                    status="live"
                    copy="Simulate + Digiflazz testing dengan request_ref idempotent. Live tetap safety-locked."
                  />
                  <RoadmapCard
                    title="Email receipt"
                    status="live"
                    copy="Brevo transactional receipt dengan delivery log dan retry."
                  />
                  <RoadmapCard
                    title="Promo engine"
                    status="live"
                    copy="Campaign CRUD, quota reservation, per-user limit, scheduling data, dan product targeting aktif."
                  />
                  <RoadmapCard
                    title="Nambah Points"
                    status="live"
                    copy="Saldo account, checkout redemption, success earning, customer ledger, dan admin monitoring aktif."
                  />
                  <RoadmapCard
                    title="Affiliate lifecycle"
                    status="live"
                    copy="Commission pending/available/cancelled mengikuti status order; ledger admin aktif."
                  />
                  <RoadmapCard
                    title="Digiflazz callback"
                    status="live"
                    copy="Callback Pending/Sukses/Gagal diterapkan ke supplier transaction dan order secara idempotent."
                  />
                  <RoadmapCard
                    title="Reconciliation & retry"
                    status="live"
                    copy="Recovery paid/processing, polling Digiflazz test pending, retry receipt failed, dan stale sending detection."
                  />
                  <RoadmapCard
                    title="Universal account checker"
                    status="live"
                    copy="Validasi schema per game + provider routing configurable, dengan local-only fallback yang tidak memblokir checkout."
                  />
                  <RoadmapCard
                    title="Production hardening"
                    status="planned"
                    copy="Health endpoint, rate limit, alert, audit log, dan explicit live guards."
                  />
                </div>
              </section>
            </>
          )}

          {section === "orders" && (
            <>
              <SectionHead
                eyebrow="Transactions"
                title="Orders"
                copy="100 order terbaru. Gunakan filter untuk audit status atau mencari transaksi."
              />
              <div className="acc-filterbar">
                <input
                  type="search"
                  placeholder="Cari order, game, user ID..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  value={orderStatusFilter}
                  onChange={(event) => setOrderStatusFilter(event.target.value)}
                >
                  <option value="all">Semua status</option>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="acc-table-card">
                <div className="acc-orders-head">
                  <span>Order</span>
                  <span>Akun</span>
                  <span>Pembayaran</span>
                  <span>Total</span>
                  <span>Status</span>
                </div>
                {filteredOrders.map((order) => (
                  <div className="acc-orders-row" key={order.id}>
                    <div>
                      <small>{order.id}</small>
                      <strong>{order.gameName}</strong>
                      <span>{order.packageLabel}</span>
                    </div>
                    <div>
                      <strong>{order.targetUserId}</strong>
                      <span>
                        {order.targetServerId
                          ? `Zone ${order.targetServerId}`
                          : "Tanpa server"}
                      </span>
                    </div>
                    <div>
                      <strong>{order.paymentName ?? "-"}</strong>
                      <span>{formatTime(order.createdAt)}</span>
                    </div>
                    <strong>{formatIDR(order.finalPrice)}</strong>
                    <div className="acc-order-status-action">
                      <span className={`acc-status ${order.status}`}>
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void inspectOrder(order.id)}
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                ))}
                {filteredOrders.length === 0 && (
                  <div className="acc-empty">Tidak ada order yang cocok.</div>
                )}
              </div>

              {orderDetail && (
                <section className="acc-order-inspector">
                  <div className="acc-order-inspector-head">
                    <div>
                      <small>ORDER INSPECTOR</small>
                      <strong>{String(orderDetail.order.id ?? "-")}</strong>
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void retryAdminReceipt(
                            String(orderDetail.order.id ?? ""),
                          )
                        }
                      >
                        Retry receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderDetail(null)}
                      >
                        Tutup
                      </button>
                    </div>
                  </div>

                  <div className="acc-order-inspector-grid">
                    <article>
                      <small>Order financial</small>
                      <pre>{JSON.stringify(orderDetail.order, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Payment</small>
                      <pre>{JSON.stringify(orderDetail.payments, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Supplier / SN</small>
                      <pre>{JSON.stringify(orderDetail.supplierTransactions, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Receipt</small>
                      <pre>{JSON.stringify(orderDetail.receipts, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Commission</small>
                      <pre>{JSON.stringify(orderDetail.commissions, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Points / Promo</small>
                      <pre>{JSON.stringify({
                        points: orderDetail.points,
                        promotions: orderDetail.promotionRedemptions,
                      }, null, 2)}</pre>
                    </article>
                  </div>
                </section>
              )}
            </>
          )}

          {section === "catalog" && catalog && (
            <>
              <SectionHead
                eyebrow="Catalog"
                title="Produk & pricing"
                copy="Edit label, harga, status, dan mapping SKU tanpa mengubah source supplier."
              />
              <div className="acc-filterbar acc-filterbar-three">
                <input
                  type="search"
                  placeholder="Cari produk, ID, SKU..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  value={gameFilter}
                  onChange={(event) => setGameFilter(event.target.value)}
                >
                  <option value="all">Semua game</option>
                  {catalog.games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
                <select
                  value={mappingFilter}
                  onChange={(event) => setMappingFilter(event.target.value)}
                >
                  <option value="all">Semua mapping</option>
                  <option value="ready">Ready</option>
                  <option value="mapped">Mapped</option>
                  <option value="unmapped">Unmapped</option>
                </select>
              </div>

              <div className="admin-catalog-card acc-catalog-card">
                <div className="admin-table-head">
                  <span>Produk</span>
                  <span>Harga Nambah</span>
                  <span>Digiflazz</span>
                  <span>Status</span>
                  <span />
                </div>
                <div className="admin-product-list">
                  {filteredProducts.map((product) => {
                    const draft =
                      drafts[product.id] ?? draftFromProduct(product);
                    const saving = busy === `save:${product.id}`;

                    return (
                      <article className="admin-product-row" key={product.id}>
                        <div className="admin-product-main">
                          <small>
                            {product.gameShortName} · {product.id}
                          </small>
                          <input
                            className="admin-inline-name"
                            value={draft.label}
                            onChange={(event) =>
                              updateDraft(product.id, {
                                label: event.target.value,
                              })
                            }
                          />
                          <input
                            className="admin-inline-note"
                            value={draft.note}
                            placeholder="Catatan produk"
                            onChange={(event) =>
                              updateDraft(product.id, {
                                note: event.target.value,
                              })
                            }
                          />
                        </div>

                        <div className="admin-price-fields">
                          <label>
                            <span>Harga jual</span>
                            <input
                              type="number"
                              value={draft.sellingPrice}
                              onChange={(event) =>
                                updateDraft(product.id, {
                                  sellingPrice: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>Harga coret</span>
                            <input
                              type="number"
                              value={draft.referencePrice}
                              onChange={(event) =>
                                updateDraft(product.id, {
                                  referencePrice: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>

                        <div className="admin-supplier-fields">
                          <label>
                            <span>SKU supplier</span>
                            <input
                              value={draft.supplierSku}
                              placeholder="Belum mapped"
                              onChange={(event) =>
                                updateDraft(product.id, {
                                  supplierSku: event.target.value,
                                })
                              }
                            />
                          </label>
                          <div className="admin-cost-line">
                            <span>Modal</span>
                            <strong>
                              {product.supplier.cost === null
                                ? "-"
                                : formatIDR(product.supplier.cost)}
                            </strong>
                          </div>
                        </div>

                        <div className="admin-status-stack">
                          <span
                            className={`admin-status ${
                              product.supplier.ready
                                ? "ready"
                                : product.supplier.mapped
                                  ? "warning"
                                  : "muted"
                            }`}
                          >
                            {product.supplier.ready
                              ? "Supplier ready"
                              : product.supplier.mapped
                                ? "Mapped / unavailable"
                                : "Unmapped"}
                          </span>
                          <label className="admin-toggle">
                            <input
                              type="checkbox"
                              checked={draft.active}
                              onChange={(event) =>
                                updateDraft(product.id, {
                                  active: event.target.checked,
                                })
                              }
                            />
                            Aktif
                          </label>
                        </div>

                        <button
                          className="admin-save-button"
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void saveProduct(product)}
                        >
                          {saving ? "Saving..." : "Simpan"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {section === "supplier" && catalog && (
            <>
              <SectionHead
                eyebrow="Supplier"
                title="Digiflazz operations"
                copy="Saldo, sync price list, mapping, dan automation supplier."
                action={
                  <Link className="acc-primary-link" href="/admin/digiflazz">
                    Buka supplier catalog →
                  </Link>
                }
              />

              <div className="acc-metrics acc-metrics-three">
                <article>
                  <small>Saldo tersedia</small>
                  <strong>{formatIDR(catalog.balance.availableBalance)}</strong>
                  <span>{formatTime(catalog.balance.checkedAt)}</span>
                </article>
                <article>
                  <small>Ready supplier</small>
                  <strong>{catalog.stats.ready}</strong>
                  <span>{catalog.stats.mapped} mapped</span>
                </article>
                <article>
                  <small>Perlu mapping</small>
                  <strong>{catalog.stats.unmapped}</strong>
                  <span>Dari {catalog.stats.total} produk</span>
                </article>
              </div>

              <div className="acc-action-panel">
                <button
                  type="button"
                  onClick={() => void checkBalance()}
                  disabled={Boolean(busy)}
                >
                  Cek saldo
                </button>
                <button
                  type="button"
                  onClick={() => void syncPrices()}
                  disabled={Boolean(busy)}
                >
                  Sync harga supplier
                </button>
                <button
                  type="button"
                  onClick={() => void runBootstrap(false)}
                  disabled={Boolean(busy)}
                >
                  Scan mapping
                </button>
                <button
                  type="button"
                  onClick={() => void runBootstrap(true)}
                  disabled={Boolean(busy)}
                >
                  Auto-map aman
                </button>
              </div>

              <AdminCatalogTools />
            </>
          )}

          {section === "receipts" && (
            <>
              <SectionHead
                eyebrow="Delivery"
                title="Receipt email"
                copy="Log Brevo untuk melihat receipt terkirim, retry, dan error provider."
              />
              <div className="acc-table-card">
                <div className="acc-receipts-head">
                  <span>Order</span>
                  <span>Recipient</span>
                  <span>Provider</span>
                  <span>Attempt</span>
                  <span>Status</span>
                </div>
                {receipts.map((receipt) => (
                  <div className="acc-receipts-row" key={receipt.id}>
                    <div>
                      <strong>{receipt.orderId}</strong>
                      <span>{formatTime(receipt.createdAt)}</span>
                    </div>
                    <span>{receipt.recipient}</span>
                    <div>
                      <strong>{receipt.provider}</strong>
                      <span>
                        {receipt.providerMessageId
                          ? receipt.providerMessageId
                          : "Belum ada message ID"}
                      </span>
                    </div>
                    <strong>{receipt.attempts}</strong>
                    <div>
                      <span className={`acc-status receipt-${receipt.status}`}>
                        {receipt.status}
                      </span>
                      {receipt.lastError && (
                        <small className="acc-error-text">
                          {receipt.lastError}
                        </small>
                      )}
                    </div>
                  </div>
                ))}
                {receipts.length === 0 && (
                  <div className="acc-empty">Belum ada log receipt.</div>
                )}
              </div>
            </>
          )}

          {section === "points" && pointsData && (
            <>
              <SectionHead
                eyebrow="Loyalty"
                title="Nambah Points"
                copy="Outstanding liability, reservation, account balance, dan immutable ledger points."
              />

              <div className="acc-metrics">
                <article>
                  <small>Outstanding</small>
                  <strong>{pointsData.stats.outstanding.toLocaleString("id-ID")} pts</strong>
                  <span>≈ {formatIDR(pointsData.stats.outstanding * pointsData.rules.pointValueIdr)}</span>
                </article>
                <article>
                  <small>Available</small>
                  <strong>{pointsData.stats.available.toLocaleString("id-ID")} pts</strong>
                  <span>{pointsData.stats.accounts} akun loyalty</span>
                </article>
                <article>
                  <small>Reserved</small>
                  <strong>{pointsData.stats.reserved.toLocaleString("id-ID")} pts</strong>
                  <span>Checkout belum final</span>
                </article>
                <article>
                  <small>Lifetime redeemed</small>
                  <strong>{pointsData.stats.lifetimeRedeemed.toLocaleString("id-ID")} pts</strong>
                  <span>Dari {pointsData.stats.lifetimeEarned.toLocaleString("id-ID")} earned</span>
                </article>
              </div>

              <div className="acc-points-rules">
                <span>1 pt / {formatIDR(pointsData.rules.earnEveryIdr)}</span>
                <span>1 pt = {formatIDR(pointsData.rules.pointValueIdr)}</span>
                <span>Min. {pointsData.rules.minimumRedeem} pts</span>
                <span>Step {pointsData.rules.redeemStep} pts</span>
                <span>Max {Math.round(pointsData.rules.maxRedeemRate * 100)}% subtotal</span>
              </div>

              <div className="acc-grid-two acc-points-grid">
                <div className="acc-table-card">
                  <div className="acc-points-head">
                    <span>User</span>
                    <span>Available</span>
                    <span>Reserved</span>
                  </div>
                  {pointsData.accounts.slice(0, 20).map((account) => (
                    <div className="acc-points-row" key={account.userId}>
                      <div>
                        <strong>{account.userId.slice(0, 8)}…</strong>
                        <small>{formatTime(account.updatedAt)}</small>
                      </div>
                      <strong>{account.available.toLocaleString("id-ID")} pts</strong>
                      <span>{account.reserved.toLocaleString("id-ID")} pts</span>
                    </div>
                  ))}
                  {pointsData.accounts.length === 0 && (
                    <div className="acc-empty">Belum ada loyalty account.</div>
                  )}
                </div>

                <div className="acc-table-card">
                  <div className="acc-points-ledger-head">
                    <span>Aktivitas terbaru</span>
                    <span>Delta</span>
                  </div>
                  {pointsData.ledger.slice(0, 25).map((entry) => (
                    <div className="acc-points-ledger-row" key={entry.id}>
                      <div>
                        <strong>{entry.type}</strong>
                        <small>
                          {entry.orderId ??
                            entry.userId.slice(0, 8) + "…"} · {formatTime(entry.createdAt)}
                        </small>
                      </div>
                      <b
                        className={
                          entry.pointsDelta > 0
                            ? "positive"
                            : entry.pointsDelta < 0
                              ? "negative"
                              : ""
                        }
                      >
                        {entry.pointsDelta !== 0
                          ? (entry.pointsDelta > 0 ? "+" : "") +
                            entry.pointsDelta.toLocaleString("id-ID")
                          : (entry.reservedDelta > 0 ? "+" : "") +
                            entry.reservedDelta.toLocaleString("id-ID") +
                            " res."}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {section === "promotions" && overview && promotionData && (
            <>
              <SectionHead
                eyebrow="Growth"
                title="Promotions"
                copy="Campaign promo dikelola tanpa SQL, dengan quota reservation yang aman terhadap checkout paralel."
              />

              <div className="acc-module-summary">
                <article>
                  <small>Active promotions</small>
                  <strong>{promotionData.promotions.filter((item) => item.active).length}</strong>
                  <span>{promotionData.promotions.length} total campaign</span>
                </article>
                <article>
                  <small>Redeemed</small>
                  <strong>{promotionData.promotions.reduce((sum, item) => sum + item.redeemed, 0)}</strong>
                  <span>{promotionData.promotions.reduce((sum, item) => sum + item.reserved, 0)} reserved</span>
                </article>
              </div>

              <div className="acc-action-panel">
                <input
                  placeholder="CODE"
                  value={promoDraft.code}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      code: event.target.value.toUpperCase(),
                    }))
                  }
                />
                <input
                  placeholder="Nama campaign"
                  value={promoDraft.name}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
                <select
                  value={promoDraft.type}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      type: event.target.value as "flat" | "percentage",
                    }))
                  }
                >
                  <option value="flat">Flat</option>
                  <option value="percentage">Percentage</option>
                </select>
                <input
                  type="number"
                  placeholder="Value"
                  value={promoDraft.value}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void createPromotion()}
                >
                  {busy === "promotion-create" ? "Creating..." : "Create promo"}
                </button>
              </div>

              <div className="acc-table-card">
                <div className="acc-receipts-head">
                  <span>Campaign</span>
                  <span>Benefit</span>
                  <span>Quota</span>
                  <span>Usage</span>
                  <span>Status</span>
                </div>
                {promotionData.promotions.map((promo) => (
                  <div className="acc-receipts-row" key={promo.code}>
                    <div>
                      <strong>{promo.code}</strong>
                      <span>{promo.name}</span>
                    </div>
                    <strong>
                      {promo.type === "flat"
                        ? formatIDR(promo.value)
                        : promo.value + "%"}
                    </strong>
                    <span>{promo.quota ?? "∞"}</span>
                    <span>{promo.redeemed} used · {promo.reserved} reserved</span>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void togglePromotion(promo.code, !promo.active)}
                    >
                      {promo.active ? "Active" : "Inactive"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {section === "affiliates" && overview && affiliateData && (
            <>
              <SectionHead
                eyebrow="Partners"
                title="Affiliate"
                copy="Commission lifecycle mengikuti status order dan dihitung dari net profit yang sudah memperhitungkan biaya Points."
              />
              <div className="acc-metrics">
                <article>
                  <small>Active affiliates</small>
                  <strong>{affiliateData.stats.active}</strong>
                  <span>Dari {affiliateData.stats.affiliates} partner</span>
                </article>
                <article>
                  <small>Pending</small>
                  <strong>{formatIDR(affiliateData.stats.pending)}</strong>
                  <span>Order paid / processing</span>
                </article>
                <article>
                  <small>Available</small>
                  <strong>{formatIDR(affiliateData.stats.available)}</strong>
                  <span>Siap withdrawal</span>
                </article>
                <article>
                  <small>Withdrawn</small>
                  <strong>{formatIDR(affiliateData.stats.withdrawn)}</strong>
                  <span>Sudah dibayarkan</span>
                </article>
              </div>

              <div className="acc-table-card">
                <div className="acc-receipts-head">
                  <span>Order</span>
                  <span>Affiliate</span>
                  <span>Base profit</span>
                  <span>Commission</span>
                  <span>Status</span>
                </div>
                {affiliateData.commissions.slice(0, 50).map((row) => (
                  <div className="acc-receipts-row" key={row.id}>
                    <div>
                      <strong>{row.orderId}</strong>
                      <span>{formatTime(row.createdAt)}</span>
                    </div>
                    <span>{row.affiliateCode}</span>
                    <strong>{formatIDR(row.baseProfit)}</strong>
                    <strong>{formatIDR(row.amount)}</strong>
                    <span className={"acc-status " + row.status}>{row.status}</span>
                  </div>
                ))}
                {affiliateData.commissions.length === 0 && (
                  <div className="acc-empty">Belum ada commission ledger.</div>
                )}
              </div>
            </>
          )}

          {section === "users" && (
            <>
              <SectionHead
                eyebrow="Accounts"
                title="Users & access"
                copy="Lookup customer memakai profile server-side dan agregasi transaksi tanpa mengekspos credential auth."
              />
              <div className="acc-table-card">
                <div className="acc-users-head">
                  <span>User</span>
                  <span>WhatsApp</span>
                  <span>Orders</span>
                  <span>Success spend</span>
                </div>
                {(usersData?.users ?? []).slice(0, 100).map((item) => (
                  <div className="acc-users-row" key={item.userId}>
                    <div>
                      <strong>{item.displayName ?? item.userId.slice(0, 8) + "…"}</strong>
                      <span>{item.userId}</span>
                    </div>
                    <span>{item.whatsapp ?? "-"}</span>
                    <strong>{item.orders} · {item.success} success</strong>
                    <div>
                      <strong>{formatIDR(item.spend)}</strong>
                      <span>{formatTime(item.lastOrderAt)}</span>
                    </div>
                  </div>
                ))}
                {usersData && usersData.users.length === 0 && (
                  <div className="acc-empty">Belum ada customer account activity.</div>
                )}
              </div>
            </>
          )}

          {section === "system" && overview && (
            <>
              <SectionHead
                eyebrow="Operations"
                title="System & production readiness"
                copy="Konfigurasi service sekarang dan backlog yang harus selesai sebelum live money."
              />

              <div className="acc-service-grid">
                {overview.system.services.map((service) => (
                  <article key={service.id}>
                    <span className={`acc-health ${service.state}`} />
                    <div>
                      <strong>{service.name}</strong>
                      <p>{service.detail}</p>
                    </div>
                    <b>{service.state}</b>
                  </article>
                ))}
              </div>

              <div className="acc-system-note">
                <div>
                  <small>Fulfillment mode</small>
                  <strong>{overview.system.fulfillmentMode}</strong>
                </div>
                <div>
                  <small>Flow test</small>
                  <strong>
                    {overview.system.flowTest ? "Enabled" : "Disabled"}
                  </strong>
                </div>
              </div>

              <div className="acc-action-panel">
                <button
                  type="button"
                  onClick={() => void runReconciliation()}
                  disabled={Boolean(busy)}
                >
                  {busy === "reconciliation"
                    ? "Reconciling..."
                    : "Run reconciliation"}
                </button>
                <span className="acc-status processing">
                  {numberOrDash(overview.stats.supplierPending)} supplier pending
                </span>
                <span className="acc-status receipt-sending">
                  {numberOrDash(overview.stats.receiptSending)} receipt sending
                </span>
              </div>

              <div className="acc-roadmap-grid">
                <RoadmapCard
                  title="Digiflazz webhook apply"
                  status="live"
                  copy="Update supplier transaction dan order dari callback supplier dengan terminal-status guard dan receipt trigger."
                />
                <RoadmapCard
                  title="Reconciliation cron"
                  status="live"
                  copy="Endpoint cron + manual admin memulihkan order tertunda, supplier pending test, dan receipt failed secara idempotent."
                />
                <RoadmapCard
                  title="Commission lifecycle"
                  status="live"
                  copy="Commission pending saat paid/processing, available saat success, dan cancelled saat failure/refund."
                />
                <RoadmapCard
                  title="Rate limit & abuse guard"
                  status="planned"
                  copy="Checkout, checker, auth, dan admin endpoint diberi limit serta observability."
                />
                <RoadmapCard
                  title="Health & alerts"
                  status="planned"
                  copy="Service health, low balance, provider failures, dan operational alerts."
                />
                <RoadmapCard
                  title="Live safety gate"
                  status="live"
                  copy="Template customer_no per game/product, frozen max_price, SKU mapping, dan double opt-in sebelum saldo Digiflazz dapat terpakai."
                />
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
