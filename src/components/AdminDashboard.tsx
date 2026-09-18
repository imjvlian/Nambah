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
  }, [section, authState, orders.length, receipts.length]);

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
                    status="foundation"
                    copy="Pricing dan database promo aktif; management UI lengkap masih berikutnya."
                  />
                  <RoadmapCard
                    title="Affiliate lifecycle"
                    status="foundation"
                    copy="Referral pricing dan tabel commission tersedia; lifecycle pending/available/withdraw masih perlu otomasi."
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
                    status="planned"
                    copy="Router checker per-game berbasis Volsever dengan fallback yang aman."
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
                    <span className={`acc-status ${order.status}`}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                  </div>
                ))}
                {filteredOrders.length === 0 && (
                  <div className="acc-empty">Tidak ada order yang cocok.</div>
                )}
              </div>
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

          {section === "promotions" && overview && (
            <>
              <SectionHead
                eyebrow="Growth"
                title="Promotions"
                copy="Engine promo sudah dipakai pricing. Management UI berikutnya akan mengelola campaign tanpa SQL."
              />
              <div className="acc-module-summary">
                <article>
                  <small>Active promotions</small>
                  <strong>
                    {numberOrDash(overview.stats.activePromotions)}
                  </strong>
                  <span>Database + pricing engine aktif</span>
                </article>
                <article className="planned">
                  <small>Next controls</small>
                  <strong>Create / schedule</strong>
                  <span>Quota, per-user limit, product targeting, audit log</span>
                </article>
              </div>
              <div className="acc-planned-list">
                <span>Campaign create/edit</span>
                <span>Product-specific promo</span>
                <span>Start/end scheduling</span>
                <span>Quota & quota per user</span>
                <span>Promo usage analytics</span>
              </div>
            </>
          )}

          {section === "affiliates" && overview && (
            <>
              <SectionHead
                eyebrow="Partners"
                title="Affiliate"
                copy="Referral benefit sudah masuk pricing. Modul berikutnya menyelesaikan commission lifecycle dan withdrawal."
              />
              <div className="acc-module-summary">
                <article>
                  <small>Active affiliates</small>
                  <strong>
                    {numberOrDash(overview.stats.activeAffiliates)}
                  </strong>
                  <span>Referral pricing aktif</span>
                </article>
                <article className="planned">
                  <small>Commission rule</small>
                  <strong>20% net profit</strong>
                  <span>pending → available → withdrawn / cancelled</span>
                </article>
              </div>
              <div className="acc-planned-list">
                <span>Affiliate CRUD</span>
                <span>Commission ledger</span>
                <span>Withdrawal approval</span>
                <span>Refund/failure cancellation</span>
                <span>Partner performance analytics</span>
              </div>
            </>
          )}

          {section === "users" && (
            <>
              <SectionHead
                eyebrow="Accounts"
                title="Users & access"
                copy="Customer account dan RBAC admin sudah live. Management user tetap dipisahkan dari password/auth provider."
              />
              <div className="acc-roadmap-grid">
                <RoadmapCard
                  title="Customer account"
                  status="live"
                  copy="Register, login, logout, session refresh, order history, dan order ownership."
                />
                <RoadmapCard
                  title="Admin RBAC"
                  status="live"
                  copy="admin_users dengan role admin/superadmin dan server-side authorization."
                />
                <RoadmapCard
                  title="Customer profile"
                  status="planned"
                  copy="Nama, WhatsApp terverifikasi, preferensi receipt, dan data profil non-auth."
                />
                <RoadmapCard
                  title="User management"
                  status="planned"
                  copy="Search user, disable access, inspect order history, dan audit action admin."
                />
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
                  status="planned"
                  copy="Create pending saat paid, available saat success, cancel saat refund/failure."
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
                  status="planned"
                  copy="Customer number formatter per game, explicit opt-in, dan production checklist sebelum spend saldo."
                />
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
