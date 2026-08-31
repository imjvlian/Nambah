"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";

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

type BootstrapResult = {
  mode: string;
  summary?: {
    supplierCatalogItems?: number;
    nambahProducts?: number;
    alreadyMapped?: number;
    suggested?: number;
    autoMapped?: number;
    unmapped?: number;
  };
};

function formatTime(value: string | null) {
  if (!value) return "Belum pernah";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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

export default function AdminDashboard() {
  const [authState, setAuthState] = useState<"loading" | "guest" | "ready">("loading");
  const [token, setToken] = useState("");
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftProduct>>({});
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const [mappingFilter, setMappingFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  function hydrateDrafts(payload: CatalogPayload) {
    setDrafts(
      Object.fromEntries(payload.products.map((product) => [product.id, draftFromProduct(product)])),
    );
  }

  async function loadCatalog() {
    const response = await fetch("/api/admin/catalog", { cache: "no-store" });
    if (response.status === 401) {
      setAuthState("guest");
      setCatalog(null);
      return;
    }

    const data = (await response.json()) as CatalogPayload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Katalog admin gagal dimuat.");

    setCatalog(data);
    hydrateDrafts(data);
    setAuthState("ready");
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const response = await fetch("/api/admin/session", { cache: "no-store" });
        const data = (await response.json()) as {
          configured?: boolean;
          authenticated?: boolean;
        };
        if (!mounted) return;

        if (!data.configured || !data.authenticated) {
          setAuthState("guest");
          return;
        }

        await loadCatalog();
      } catch {
        if (mounted) {
          setAuthState("guest");
          setNotice("Dashboard admin belum dapat dihubungi.");
        }
      }
    }

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");
    setNotice("");

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(data.error ?? "Login admin gagal.");
        return;
      }

      setToken("");
      await loadCatalog();
    } catch {
      setNotice("Tidak dapat login ke dashboard admin.");
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    setBusy("logout");
    try {
      await fetch("/api/admin/session", { method: "DELETE" });
    } finally {
      setCatalog(null);
      setDrafts({});
      setAuthState("guest");
      setBusy("");
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
      setNotice(`${product.id}: mapping SKU tidak dikosongkan dari form ini. Isi SKU baru atau biarkan SKU lama.`);
      return;
    }

    setBusy(`save:${product.id}`);
    setNotice("");

    try {
      const updateResponse = await fetch(
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
      const updateData = (await updateResponse.json()) as { error?: string };
      if (!updateResponse.ok) throw new Error(updateData.error ?? "Produk gagal disimpan.");

      if (nextSku && nextSku.toUpperCase() !== currentSku.toUpperCase()) {
        const mappingResponse = await fetch("/api/admin/digiflazz/map-sku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, supplierSku: nextSku }),
        });
        const mappingData = (await mappingResponse.json()) as { error?: string };
        if (!mappingResponse.ok) {
          throw new Error(mappingData.error ?? "Mapping SKU Digiflazz gagal.");
        }
      }

      await loadCatalog();
      setNotice(`${product.id} berhasil diperbarui.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Produk gagal diperbarui.");
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
      const result = (await response.json()) as BootstrapResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Bootstrap Digiflazz gagal.");

      const summary = result.summary;
      setNotice(
        apply
          ? `Auto-map selesai. ${summary?.autoMapped ?? 0} produk baru dipetakan, ${summary?.unmapped ?? 0} masih perlu dicek.`
          : `Scan selesai. ${summary?.suggested ?? 0} produk punya kandidat auto-map, ${summary?.unmapped ?? 0} belum cocok.`,
      );

      if (apply) await loadCatalog();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Bootstrap Digiflazz gagal.");
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
        summary?: { found?: number; costChanged?: number; missing?: number };
      };
      if (!response.ok) throw new Error(result.error ?? "Sinkronisasi harga gagal.");

      await loadCatalog();
      setNotice(
        `Harga supplier tersinkron. ${result.summary?.found ?? 0} SKU ditemukan, ${result.summary?.costChanged ?? 0} harga berubah, ${result.summary?.missing ?? 0} hilang dari price list.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sinkronisasi harga gagal.");
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
      const result = (await response.json()) as { error?: string; availableBalance?: number };
      if (!response.ok) throw new Error(result.error ?? "Cek saldo gagal.");

      await loadCatalog();
      setNotice(`Saldo Digiflazz diperbarui: ${formatIDR(result.availableBalance ?? 0)} tersedia.`);
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

  if (authState === "loading") {
    return <main className="admin-shell"><div className="admin-loading">Memuat dashboard admin...</div></main>;
  }

  if (authState === "guest") {
    return (
      <main className="admin-shell admin-login-shell">
        <section className="admin-login-card">
          <Link className="brand" href="/"><span className="brand-mark">N+</span><span>Nambah</span></Link>
          <span className="admin-kicker">Admin</span>
          <h1>Kelola katalog Nambah.</h1>
          <p>Masukkan <code>NAMBAH_ADMIN_API_TOKEN</code>. Token ditukar menjadi session HttpOnly dan tidak disimpan di localStorage.</p>
          <form onSubmit={login}>
            <input
              autoComplete="current-password"
              type="password"
              placeholder="Admin API token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <button className="primary-button full" disabled={!token || busy === "login"} type="submit">
              {busy === "login" ? "Masuk..." : "Masuk dashboard"} <span>→</span>
            </button>
          </form>
          {notice && <p className="admin-notice error">{notice}</p>}
        </section>
      </main>
    );
  }

  if (!catalog) return null;

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <Link className="brand" href="/"><span className="brand-mark">N+</span><span>Nambah</span></Link>
        <div className="admin-header-actions">
          <Link href="/" className="admin-text-link">Lihat website</Link>
          <button type="button" className="admin-text-button" onClick={() => void logout()} disabled={busy === "logout"}>Keluar</button>
        </div>
      </header>

      <section className="admin-hero">
        <div>
          <span className="admin-kicker">Catalog Control</span>
          <h1>Dashboard katalog.</h1>
          <p>Mapping Digiflazz, harga jual, status produk, sinkronisasi supplier, dan saldo ada di satu tempat.</p>
        </div>
        <div className="admin-balance-card">
          <small>Saldo tersedia Digiflazz</small>
          <strong>{formatIDR(catalog.balance.availableBalance)}</strong>
          <span>Dicek {formatTime(catalog.balance.checkedAt)}</span>
        </div>
      </section>

      <section className="admin-stats">
        <div><small>Total produk</small><strong>{catalog.stats.total}</strong></div>
        <div><small>Produk aktif</small><strong>{catalog.stats.active}</strong></div>
        <div><small>SKU mapped</small><strong>{catalog.stats.mapped}</strong></div>
        <div><small>Ready supplier</small><strong>{catalog.stats.ready}</strong></div>
        <div><small>Belum mapped</small><strong>{catalog.stats.unmapped}</strong></div>
      </section>

      <section className="admin-toolbar">
        <div className="admin-action-group">
          <button type="button" onClick={() => void runBootstrap(false)} disabled={Boolean(busy)}>
            {busy === "bootstrap-scan" ? "Scanning..." : "Scan katalog Digiflazz"}
          </button>
          <button type="button" onClick={() => void runBootstrap(true)} disabled={Boolean(busy)}>
            {busy === "bootstrap-apply" ? "Mapping..." : "Auto-map aman"}
          </button>
          <button type="button" onClick={() => void syncPrices()} disabled={Boolean(busy)}>
            {busy === "sync" ? "Sync..." : "Sync harga supplier"}
          </button>
          <button type="button" onClick={() => void checkBalance()} disabled={Boolean(busy)}>
            {busy === "balance" ? "Checking..." : "Cek saldo"}
          </button>
        </div>
        {notice && <p className="admin-notice">{notice}</p>}
      </section>

      <section className="admin-filters">
        <input
          type="search"
          placeholder="Cari produk, ID, atau SKU..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={gameFilter} onChange={(event) => setGameFilter(event.target.value)}>
          <option value="all">Semua game</option>
          {catalog.games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
        </select>
        <select value={mappingFilter} onChange={(event) => setMappingFilter(event.target.value)}>
          <option value="all">Semua mapping</option>
          <option value="ready">Ready</option>
          <option value="mapped">Sudah mapped</option>
          <option value="unmapped">Belum mapped</option>
        </select>
      </section>

      <section className="admin-catalog-card">
        <div className="admin-table-head">
          <span>Produk</span>
          <span>Harga Nambah</span>
          <span>Digiflazz</span>
          <span>Status</span>
          <span />
        </div>

        <div className="admin-product-list">
          {filteredProducts.map((product) => {
            const draft = drafts[product.id] ?? draftFromProduct(product);
            const saving = busy === `save:${product.id}`;

            return (
              <article className="admin-product-row" key={product.id}>
                <div className="admin-product-main">
                  <small>{product.gameShortName} · {product.id}</small>
                  <input
                    className="admin-inline-name"
                    value={draft.label}
                    onChange={(event) => updateDraft(product.id, { label: event.target.value })}
                  />
                  <input
                    className="admin-inline-note"
                    placeholder="Catatan produk"
                    value={draft.note}
                    onChange={(event) => updateDraft(product.id, { note: event.target.value })}
                  />
                </div>

                <div className="admin-price-fields">
                  <label><span>Jual</span><input type="number" min="1" value={draft.sellingPrice} onChange={(event) => updateDraft(product.id, { sellingPrice: event.target.value })} /></label>
                  <label><span>Coret</span><input type="number" min="1" value={draft.referencePrice} onChange={(event) => updateDraft(product.id, { referencePrice: event.target.value })} /></label>
                </div>

                <div className="admin-supplier-fields">
                  <label><span>SKU</span><input placeholder="SKU Digiflazz" value={draft.supplierSku} onChange={(event) => updateDraft(product.id, { supplierSku: event.target.value })} /></label>
                  <div className="admin-cost-line">
                    <span>Modal</span>
                    <strong>{product.supplier.cost === null ? "-" : formatIDR(product.supplier.cost)}</strong>
                  </div>
                  <small>{product.supplier.lastSyncedAt ? `Sync ${formatTime(product.supplier.lastSyncedAt)}` : "Belum sync live"}</small>
                </div>

                <div className="admin-status-stack">
                  <span className={`admin-status ${product.supplier.ready ? "ready" : product.supplier.mapped ? "warning" : "muted"}`}>
                    {product.supplier.ready ? "Supplier ready" : product.supplier.mapped ? "Supplier inactive" : "Belum mapped"}
                  </span>
                  <label className="admin-toggle">
                    <input type="checkbox" checked={draft.active} onChange={(event) => updateDraft(product.id, { active: event.target.checked })} />
                    <span>{draft.active ? "Tampil" : "Disembunyikan"}</span>
                  </label>
                </div>

                <button className="admin-save-button" type="button" disabled={Boolean(busy)} onClick={() => void saveProduct(product)}>
                  {saving ? "Simpan..." : "Simpan"}
                </button>
              </article>
            );
          })}
        </div>

        {filteredProducts.length === 0 && <div className="admin-empty">Tidak ada produk yang cocok dengan filter.</div>}
      </section>
    </main>
  );
}
