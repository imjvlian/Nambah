"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";

type SupplierItem = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  type: string;
  seller: string;
  cost: number;
  buyerActive: boolean;
  sellerActive: boolean;
  unlimitedStock: boolean;
  stock: number | null;
  multi: boolean;
  startCutOff: string | null;
  endCutOff: string | null;
  description: string | null;
  lastSeenAt: string;
  mapping: {
    productId: string;
    label: string;
    gameName: string | null;
    published: boolean;
  } | null;
};

type FilterOptions = {
  categories: string[];
  brands: string[];
  types: string[];
  sellers: string[];
};

type CatalogFilters = {
  category: string;
  brand: string;
  type: string;
  seller: string;
  availability: string;
  mapping: string;
  visibility: string;
  mode: string;
};

type SupplierCatalogPayload = {
  latestScanAt: string | null;
  scanTotal: number;
  publishedCount: number;
  total: number;
  page: number;
  limit: number;
  pages: number;
  items: SupplierItem[];
  filterOptions?: FilterOptions;
};

type BatchPublicationResult = {
  supplierSku: string;
  ok: boolean;
  error?: string;
  publication?: {
    supplierSku: string;
    productId: string | null;
    published: boolean;
    created: boolean;
  };
};

type BatchPublicationPayload = {
  error?: string;
  summary?: {
    requested: number;
    succeeded: number;
    failed: number;
    published: number;
    hidden: number;
    created: number;
  };
  results?: BatchPublicationResult[];
};

const DEFAULT_FILTERS: CatalogFilters = {
  category: "all",
  brand: "all",
  type: "all",
  seller: "all",
  availability: "all",
  mapping: "all",
  visibility: "all",
  mode: "all",
};

const EMPTY_OPTIONS: FilterOptions = {
  categories: [],
  brands: [],
  types: [],
  sellers: [],
};

const SAVE_BATCH_SIZE = 25;

function formatTime(value: string | null) {
  if (!value) return "Belum pernah";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function iconUrl(name: string) {
  return `/api/icons/game?v=store-1&name=${encodeURIComponent(name || "Produk Digital")}`;
}

function isPublished(item: SupplierItem) {
  return Boolean(item.mapping?.published);
}

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

export default function DigiflazzCatalogBrowserV2() {
  const [payload, setPayload] = useState<SupplierCatalogPayload | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CatalogFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [publicationDrafts, setPublicationDrafts] = useState<Record<string, boolean>>({});

  async function load(
    nextPage = page,
    nextQuery = query,
    nextFilters = filters,
    includeOptions = false,
  ) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: "100",
        includeOptions: includeOptions ? "true" : "false",
      });

      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      for (const [key, value] of Object.entries(nextFilters)) {
        if (value !== "all") params.set(key, value);
      }

      const response = await fetch(`/api/admin/digiflazz/catalog?${params.toString()}`, {
        cache: "no-store",
      });

      if (response.status === 401) {
        setUnauthorized(true);
        setPayload(null);
        return;
      }

      const data = (await response.json()) as SupplierCatalogPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Katalog Digiflazz gagal dimuat.");

      setUnauthorized(false);
      setPayload(data);
      if (data.filterOptions) setFilterOptions(data.filterOptions);
      setPage(data.page);
      setPublicationDrafts((current) => {
        const next = { ...current };
        for (const item of data.items) {
          if (
            Object.prototype.hasOwnProperty.call(next, item.sku) &&
            next[item.sku] === isPublished(item)
          ) {
            delete next[item.sku];
          }
        }
        return next;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Katalog Digiflazz gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1, "", DEFAULT_FILTERS, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeFilter<Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
    void load(1, query, next, false);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = queryInput.trim();
    setQuery(next);
    setPage(1);
    void load(1, next, filters, false);
  }

  function resetFilters() {
    setQueryInput("");
    setQuery("");
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    setAdvancedOpen(false);
    void load(1, "", DEFAULT_FILTERS, false);
  }

  async function scanCatalog() {
    if (Object.keys(publicationDrafts).length > 0) {
      setNotice("Simpan atau batalkan perubahan checkbox sebelum scan ulang Digiflazz.");
      return;
    }

    setBusy("scan");
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false, remap: false }),
      });
      const data = (await response.json()) as {
        error?: string;
        summary?: { supplierCatalogItems?: number };
      };
      if (!response.ok) throw new Error(data.error ?? "Scan Digiflazz gagal.");

      setPage(1);
      await load(1, query, filters, true);
      setNotice(
        `Scan selesai. ${data.summary?.supplierCatalogItems ?? 0} SKU prepaid diterima dari Digiflazz. Centang produk lalu simpan sekali.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Scan Digiflazz gagal.");
    } finally {
      setBusy("");
    }
  }

  function draftPublished(item: SupplierItem) {
    return publicationDrafts[item.sku] ?? isPublished(item);
  }

  function setPublicationDraft(item: SupplierItem, nextPublished: boolean) {
    const saved = isPublished(item);
    const ready = item.buyerActive && item.sellerActive;

    if (nextPublished && !ready && !saved) {
      setNotice(`${item.sku} sedang tidak aktif di supplier dan tidak bisa ditampilkan.`);
      return;
    }

    setPublicationDrafts((current) => {
      const next = { ...current };
      if (nextPublished === saved) delete next[item.sku];
      else next[item.sku] = nextPublished;
      return next;
    });
  }

  function setCurrentPagePublished(nextPublished: boolean) {
    if (!payload) return;

    setPublicationDrafts((current) => {
      const next = { ...current };
      for (const item of payload.items) {
        const saved = isPublished(item);
        const ready = item.buyerActive && item.sellerActive;
        if (nextPublished && !ready && !saved) continue;

        if (nextPublished === saved) delete next[item.sku];
        else next[item.sku] = nextPublished;
      }
      return next;
    });
  }

  async function savePublicationDrafts() {
    const pending = Object.entries(publicationDrafts).map(([supplierSku, published]) => ({
      supplierSku,
      published,
    }));
    if (pending.length === 0) return;

    setBusy("publish-save");
    setNotice("");

    const succeededSkus = new Set<string>();
    const failures: Array<{ supplierSku: string; error: string }> = [];
    let publishedCount = 0;
    let hiddenCount = 0;
    let createdCount = 0;

    try {
      for (const batch of chunk(pending, SAVE_BATCH_SIZE)) {
        const response = await fetch("/api/admin/digiflazz/catalog/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: batch }),
        });
        const data = (await response.json()) as BatchPublicationPayload;
        if (!response.ok) {
          throw new Error(data.error ?? "Perubahan tampilan katalog gagal disimpan.");
        }

        publishedCount += data.summary?.published ?? 0;
        hiddenCount += data.summary?.hidden ?? 0;
        createdCount += data.summary?.created ?? 0;

        for (const result of data.results ?? []) {
          if (result.ok) succeededSkus.add(result.supplierSku);
          else {
            failures.push({
              supplierSku: result.supplierSku,
              error: result.error ?? "Gagal disimpan.",
            });
          }
        }
      }

      setPublicationDrafts((current) => {
        const next = { ...current };
        for (const supplierSku of succeededSkus) delete next[supplierSku];
        return next;
      });

      await load(page, query, filters, false);

      if (failures.length > 0) {
        const preview = failures
          .slice(0, 3)
          .map((item) => `${item.supplierSku}: ${item.error}`)
          .join(" · ");
        setNotice(`${succeededSkus.size} perubahan tersimpan, ${failures.length} gagal. ${preview}`);
      } else {
        setNotice(
          `${succeededSkus.size} perubahan tersimpan. ${publishedCount} ditampilkan, ${hiddenCount} disembunyikan${createdCount ? `, ${createdCount} produk Nambah dibuat baru` : ""}.`,
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Perubahan tampilan katalog gagal disimpan.");
    } finally {
      setBusy("");
    }
  }

  const activeFilterCount = useMemo(
    () => (query ? 1 : 0) + Object.values(filters).filter((value) => value !== "all").length,
    [filters, query],
  );

  const advancedFilterCount = useMemo(
    () =>
      [filters.category, filters.type, filters.seller, filters.mapping, filters.mode].filter(
        (value) => value !== "all",
      ).length,
    [filters],
  );

  const pendingCount = Object.keys(publicationDrafts).length;
  const pageEligibleItems = payload?.items.filter(
    (item) => (item.buyerActive && item.sellerActive) || isPublished(item),
  ) ?? [];
  const pageAllChecked =
    pageEligibleItems.length > 0 && pageEligibleItems.every((item) => draftPublished(item));

  if (unauthorized) {
    return (
      <main className="supplier-browser-shell clean-catalog">
        <section className="supplier-browser-empty">
          <span className="admin-kicker">Admin</span>
          <h1>Session admin diperlukan.</h1>
          <p>Login dulu dari Dashboard Admin, lalu buka kembali katalog supplier.</p>
          <Link className="primary-button" href="/admin">Ke Dashboard Admin <span>→</span></Link>
        </section>
      </main>
    );
  }

  return (
    <main className="supplier-browser-shell clean-catalog">
      <header className="supplier-browser-header">
        <Link className="brand" href="/"><span className="brand-mark">N+</span><span>Nambah</span></Link>
        <nav>
          <Link href="/admin">Produk Nambah</Link>
          <Link className="active" href="/admin/digiflazz">Katalog Digiflazz</Link>
        </nav>
      </header>

      <section className="supplier-browser-hero clean-hero">
        <div>
          <span className="admin-kicker">Supplier Catalog</span>
          <h1>Centang yang mau dijual.</h1>
          <p>Scan katalog Buyer Digiflazz, pilih banyak SKU dengan checkbox, lalu simpan seluruh perubahan sekali klik.</p>
        </div>
        <button type="button" onClick={() => void scanCatalog()} disabled={Boolean(busy)}>
          {busy === "scan" ? "Scanning..." : "Scan ulang"}
        </button>
      </section>

      <section className="supplier-browser-stats clean-stats">
        <div><small>Hasil scan</small><strong>{payload?.scanTotal ?? 0}</strong></div>
        <div><small>Ditampilkan</small><strong>{payload?.publishedCount ?? 0}</strong></div>
        <div><small>Hasil filter</small><strong>{payload?.total ?? 0}</strong></div>
        <div><small>Belum disimpan</small><strong>{pendingCount}</strong></div>
        <div><small>Terakhir scan</small><strong className="small-value">{formatTime(payload?.latestScanAt ?? null)}</strong></div>
      </section>

      <section className="catalog-filter-card">
        <form className="catalog-search-row" onSubmit={submitSearch}>
          <div className="catalog-search-field">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Cari nama produk atau SKU"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
            />
          </div>
          <button type="submit" disabled={loading || Boolean(busy)}>Cari</button>
        </form>

        <div className="catalog-primary-filters">
          <label className="catalog-compact-select wide">
            <span>Brand</span>
            <select value={filters.brand} onChange={(event) => changeFilter("brand", event.target.value)} disabled={Boolean(busy)}>
              <option value="all">Semua brand</option>
              {filterOptions.brands.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label className="catalog-compact-select">
            <span>Status</span>
            <select value={filters.availability} onChange={(event) => changeFilter("availability", event.target.value)} disabled={Boolean(busy)}>
              <option value="all">Semua</option>
              <option value="ready">Siap dijual</option>
              <option value="buyer-inactive">Buyer off</option>
              <option value="seller-inactive">Seller off</option>
            </select>
          </label>

          <label className="catalog-compact-select">
            <span>Tampilan</span>
            <select value={filters.visibility} onChange={(event) => changeFilter("visibility", event.target.value)} disabled={Boolean(busy)}>
              <option value="all">Semua</option>
              <option value="published">Ditampilkan</option>
              <option value="hidden">Disembunyikan</option>
            </select>
          </label>

          <button
            className={advancedOpen || advancedFilterCount ? "catalog-more active" : "catalog-more"}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            Filter lainnya{advancedFilterCount ? ` · ${advancedFilterCount}` : ""}
            <span>{advancedOpen ? "↑" : "↓"}</span>
          </button>

          {activeFilterCount > 0 && (
            <button className="catalog-reset" type="button" onClick={resetFilters} disabled={loading || Boolean(busy)}>
              Reset
            </button>
          )}
        </div>

        {advancedOpen && (
          <div className="catalog-advanced-filters">
            <label><span>Kategori</span><select value={filters.category} onChange={(event) => changeFilter("category", event.target.value)} disabled={Boolean(busy)}><option value="all">Semua kategori</option>{filterOptions.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>Tipe</span><select value={filters.type} onChange={(event) => changeFilter("type", event.target.value)} disabled={Boolean(busy)}><option value="all">Semua tipe</option>{filterOptions.types.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>Seller</span><select value={filters.seller} onChange={(event) => changeFilter("seller", event.target.value)} disabled={Boolean(busy)}><option value="all">Semua seller</option>{filterOptions.sellers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>Mapping</span><select value={filters.mapping} onChange={(event) => changeFilter("mapping", event.target.value)} disabled={Boolean(busy)}><option value="all">Semua</option><option value="mapped">Sudah mapped</option><option value="unmapped">Belum mapped</option></select></label>
            <label><span>Mode</span><select value={filters.mode} onChange={(event) => changeFilter("mode", event.target.value)} disabled={Boolean(busy)}><option value="all">Semua</option><option value="single">Single</option><option value="multi">Multi</option></select></label>
          </div>
        )}

        <div className="catalog-filter-meta">
          <span>{activeFilterCount ? `${activeFilterCount} filter aktif` : "Menampilkan seluruh katalog hasil scan"}</span>
          {payload?.pages ? <span>Halaman {payload.page} / {payload.pages}</span> : null}
        </div>
      </section>

      {notice && <p className="supplier-browser-notice">{notice}</p>}

      <section className="supplier-publication-toolbar">
        <div className="supplier-publication-page-actions">
          <label className="supplier-publication-select-all">
            <input
              type="checkbox"
              checked={pageAllChecked}
              disabled={loading || Boolean(busy) || pageEligibleItems.length === 0}
              onChange={(event) => setCurrentPagePublished(event.target.checked)}
            />
            <span>Pilih semua di halaman</span>
          </label>
          <button
            type="button"
            className="supplier-publication-clear"
            disabled={loading || Boolean(busy) || !payload?.items.length}
            onClick={() => setCurrentPagePublished(false)}
          >
            Kosongkan halaman
          </button>
        </div>

        <div className={`supplier-publication-save ${pendingCount ? "dirty" : ""}`}>
          <span><strong>{pendingCount}</strong> perubahan belum disimpan</span>
          <button
            type="button"
            className="supplier-publication-discard"
            disabled={Boolean(busy) || pendingCount === 0}
            onClick={() => setPublicationDrafts({})}
          >
            Batalkan
          </button>
          <button
            type="button"
            className="supplier-publication-save-button"
            disabled={Boolean(busy) || pendingCount === 0}
            onClick={() => void savePublicationDrafts()}
          >
            {busy === "publish-save" ? "Menyimpan..." : "Simpan tampilan"}
          </button>
        </div>
      </section>

      <section className="supplier-browser-table-card clean-table">
        <div className="supplier-browser-table-head">
          <span>Produk</span><span>Harga</span><span>Status</span><span>Tampilkan</span>
        </div>

        {loading && <div className="supplier-browser-loading">Memuat katalog supplier...</div>}

        {!loading && payload?.items.map((item) => {
          const ready = item.buyerActive && item.sellerActive;
          const savedPublished = isPublished(item);
          const checked = draftPublished(item);
          const changed = Object.prototype.hasOwnProperty.call(publicationDrafts, item.sku);
          const disabled = Boolean(busy) || (!ready && !savedPublished);

          return (
            <article className={`supplier-browser-row clean-row ${changed ? "publication-dirty-row" : ""}`} key={item.sku}>
              <div className="supplier-browser-product product-with-icon">
                <img className="catalog-game-icon" src={iconUrl(item.brand)} alt="" loading="lazy" />
                <div>
                  <small>{item.brand} · {item.category} · {item.type}</small>
                  <strong>{item.name}</strong>
                  <code>{item.sku}</code>
                  {item.description && item.description !== "-" && <p>{item.description}</p>}
                </div>
              </div>

              <div className="supplier-browser-price">
                <strong>{formatIDR(item.cost)}</strong>
                <span>{item.seller}</span>
                <small>{item.unlimitedStock ? "Stok unlimited" : `Stok ${item.stock ?? 0}`} · {item.multi ? "multi" : "single"}</small>
              </div>

              <div className="supplier-browser-statuses">
                <span className={item.buyerActive ? "ok" : "off"}>Buyer {item.buyerActive ? "aktif" : "off"}</span>
                <span className={item.sellerActive ? "ok" : "off"}>Seller {item.sellerActive ? "aktif" : "off"}</span>
              </div>

              <div className="catalog-publish-cell">
                <label className={`supplier-publication-choice ${checked ? "checked" : ""} ${changed ? "dirty" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => setPublicationDraft(item, event.target.checked)}
                  />
                  <span>
                    <strong>{checked ? "Tampilkan ke user" : "Jangan tampilkan"}</strong>
                    <small>
                      {changed
                        ? "Belum disimpan"
                        : savedPublished
                          ? "Tersimpan · tampil di katalog"
                          : item.mapping
                            ? "Tersimpan · disembunyikan"
                            : "Belum dibuat di Nambah"}
                    </small>
                  </span>
                </label>
              </div>
            </article>
          );
        })}

        {!loading && payload && payload.items.length === 0 && (
          <div className="supplier-browser-loading">{payload.latestScanAt ? "Tidak ada SKU yang cocok dengan filter." : "Belum ada scan Digiflazz."}</div>
        )}
      </section>

      {payload && payload.pages > 1 && (
        <div className="supplier-browser-pagination clean-pagination">
          <button type="button" disabled={loading || Boolean(busy) || payload.page <= 1} onClick={() => void load(payload.page - 1, query, filters, false)}>← Sebelumnya</button>
          <span>{payload.total} SKU · halaman {payload.page} dari {payload.pages}</span>
          <button type="button" disabled={loading || Boolean(busy) || payload.page >= payload.pages} onClick={() => void load(payload.page + 1, query, filters, false)}>Berikutnya →</button>
        </div>
      )}
    </main>
  );
}
