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

function formatTime(value: string | null) {
  if (!value) return "Belum pernah";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function DigiflazzCatalogBrowser() {
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

  async function scanCatalog() {
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
        `Scan selesai. ${data.summary?.supplierCatalogItems ?? 0} SKU prepaid diterima dari Digiflazz. Pilih produk yang ingin ditampilkan ke user.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Scan Digiflazz gagal.");
    } finally {
      setBusy("");
    }
  }

  async function togglePublished(item: SupplierItem) {
    const ready = item.buyerActive && item.sellerActive;
    const nextPublished = !Boolean(item.mapping?.published);

    if (nextPublished && !ready) {
      setNotice(`${item.sku} sedang tidak aktif di supplier dan tidak bisa ditampilkan.`);
      return;
    }

    setBusy(`publish:${item.sku}`);
    setNotice("");

    try {
      const response = await fetch("/api/admin/digiflazz/catalog/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierSku: item.sku, published: nextPublished }),
      });
      const data = (await response.json()) as {
        error?: string;
        publication?: {
          productId?: string | null;
          published?: boolean;
          created?: boolean;
          sellingPrice?: number;
        };
      };

      if (!response.ok || !data.publication) {
        throw new Error(data.error ?? "Status tampil produk gagal diperbarui.");
      }

      await load(page, query, filters, false);

      if (nextPublished) {
        setNotice(
          `${item.name} sekarang tampil ke user${data.publication.created ? " dan katalog Nambah dibuat otomatis" : ""}${data.publication.sellingPrice ? ` dengan harga awal ${formatIDR(data.publication.sellingPrice)}` : ""}.`,
        );
      } else {
        setNotice(`${item.name} disembunyikan dari user. Mapping dan histori tetap disimpan.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Status tampil produk gagal diperbarui.");
    } finally {
      setBusy("");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = queryInput.trim();
    setQuery(next);
    setPage(1);
    void load(1, next, filters, false);
  }

  function changeFilter<Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
    void load(1, query, next, false);
  }

  function resetFilters() {
    setQueryInput("");
    setQuery("");
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    void load(1, "", DEFAULT_FILTERS, false);
  }

  const activeFilterCount = useMemo(
    () =>
      (query ? 1 : 0) +
      Object.values(filters).filter((value) => value !== "all").length,
    [filters, query],
  );

  if (unauthorized) {
    return (
      <main className="supplier-browser-shell">
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
    <main className="supplier-browser-shell">
      <header className="supplier-browser-header">
        <Link className="brand" href="/"><span className="brand-mark">N+</span><span>Nambah</span></Link>
        <nav>
          <Link href="/admin">Produk Nambah</Link>
          <Link className="active" href="/admin/digiflazz">Katalog Digiflazz</Link>
        </nav>
      </header>

      <section className="supplier-browser-hero">
        <div>
          <span className="admin-kicker">Supplier Catalog</span>
          <h1>Scan, pilih, tampilkan.</h1>
          <p>
            Digiflazz menjadi sumber katalog. Scan produk supplier lalu aktifkan hanya SKU yang ingin dijual di website Nambah.
          </p>
        </div>
        <button type="button" onClick={() => void scanCatalog()} disabled={Boolean(busy)}>
          {busy === "scan" ? "Scanning..." : "Scan ulang Digiflazz"}
        </button>
      </section>

      <section className="supplier-browser-warning">
        <strong>Publish otomatis</strong>
        <span>
          Saat SKU pertama kali ditampilkan, Nambah otomatis membuat brand/game, produk, mapping supplier, dan harga minimum aman. Produk bisa disembunyikan lagi tanpa menghapus data.
        </span>
      </section>

      <section className="supplier-browser-stats">
        <div><small>SKU scan terakhir</small><strong>{payload?.scanTotal ?? 0}</strong></div>
        <div><small>Ditampilkan ke user</small><strong>{payload?.publishedCount ?? 0}</strong></div>
        <div><small>Hasil filter</small><strong>{payload?.total ?? 0}</strong></div>
        <div><small>Terakhir scan</small><strong className="small-value">{formatTime(payload?.latestScanAt ?? null)}</strong></div>
        <div><small>Halaman</small><strong>{payload?.pages ? `${payload.page}/${payload.pages}` : "-"}</strong></div>
      </section>

      <section className="supplier-browser-tools">
        <form onSubmit={submitSearch}>
          <input
            type="search"
            placeholder="Cari SKU, nama produk, brand, kategori, seller..."
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
          <button type="submit" disabled={loading}>Cari</button>
        </form>

        <div className="supplier-browser-filter-grid">
          <label>
            <span>Kategori</span>
            <select value={filters.category} onChange={(event) => changeFilter("category", event.target.value)}>
              <option value="all">Semua kategori</option>
              {filterOptions.categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label>
            <span>Brand / game</span>
            <select value={filters.brand} onChange={(event) => changeFilter("brand", event.target.value)}>
              <option value="all">Semua brand</option>
              {filterOptions.brands.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label>
            <span>Tipe</span>
            <select value={filters.type} onChange={(event) => changeFilter("type", event.target.value)}>
              <option value="all">Semua tipe</option>
              {filterOptions.types.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label>
            <span>Seller</span>
            <select value={filters.seller} onChange={(event) => changeFilter("seller", event.target.value)}>
              <option value="all">Semua seller</option>
              {filterOptions.sellers.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label>
            <span>Status supplier</span>
            <select value={filters.availability} onChange={(event) => changeFilter("availability", event.target.value)}>
              <option value="all">Semua status</option>
              <option value="ready">Buyer + seller aktif</option>
              <option value="buyer-inactive">Buyer tidak aktif</option>
              <option value="seller-inactive">Seller tidak aktif</option>
            </select>
          </label>

          <label>
            <span>Tampil ke user</span>
            <select value={filters.visibility} onChange={(event) => changeFilter("visibility", event.target.value)}>
              <option value="all">Semua tampilan</option>
              <option value="published">Ditampilkan</option>
              <option value="hidden">Tidak ditampilkan</option>
            </select>
          </label>

          <label>
            <span>Mapping Nambah</span>
            <select value={filters.mapping} onChange={(event) => changeFilter("mapping", event.target.value)}>
              <option value="all">Semua mapping</option>
              <option value="mapped">Sudah mapped</option>
              <option value="unmapped">Belum mapped</option>
            </select>
          </label>

          <label>
            <span>Mode transaksi</span>
            <select value={filters.mode} onChange={(event) => changeFilter("mode", event.target.value)}>
              <option value="all">Single + multi</option>
              <option value="single">Single</option>
              <option value="multi">Multi</option>
            </select>
          </label>
        </div>

        <div className="supplier-browser-filter-footer">
          <span>{activeFilterCount ? `${activeFilterCount} filter aktif` : "Tidak ada filter aktif"}</span>
          {activeFilterCount > 0 && (
            <button className="ghost" type="button" onClick={resetFilters} disabled={loading}>
              Reset semua filter
            </button>
          )}
        </div>
      </section>

      {notice && <p className="supplier-browser-notice">{notice}</p>}

      <section className="supplier-browser-table-card">
        <div className="supplier-browser-table-head">
          <span>Produk Digiflazz</span>
          <span>Harga & seller</span>
          <span>Status supplier</span>
          <span>Katalog user</span>
        </div>

        {loading && <div className="supplier-browser-loading">Memuat katalog supplier...</div>}

        {!loading && payload?.items.map((item) => {
          const ready = item.buyerActive && item.sellerActive;
          const published = Boolean(item.mapping?.published);
          const publishBusy = busy === `publish:${item.sku}`;

          return (
            <article className="supplier-browser-row" key={item.sku}>
              <div className="supplier-browser-product">
                <small>{item.category} · {item.brand} · {item.type}</small>
                <strong>{item.name}</strong>
                <code>{item.sku}</code>
                {item.description && item.description !== "-" && <p>{item.description}</p>}
              </div>

              <div className="supplier-browser-price">
                <strong>{formatIDR(item.cost)}</strong>
                <span>{item.seller}</span>
                <small>
                  {item.unlimitedStock ? "Stok unlimited" : `Stok ${item.stock ?? 0}`}
                  {item.multi ? " · multi" : " · single"}
                </small>
                {(item.startCutOff || item.endCutOff) && (
                  <small>Cut off {item.startCutOff ?? "-"}–{item.endCutOff ?? "-"}</small>
                )}
              </div>

              <div className="supplier-browser-statuses">
                <span className={item.buyerActive ? "ok" : "off"}>Buyer {item.buyerActive ? "aktif" : "off"}</span>
                <span className={item.sellerActive ? "ok" : "off"}>Seller {item.sellerActive ? "aktif" : "off"}</span>
                <small>{ready ? "Siap dijual" : "Tidak bisa dipublish"}</small>
              </div>

              <div className="supplier-browser-publish">
                <button
                  className={`supplier-publish-button ${published ? "published" : ""}`}
                  type="button"
                  disabled={Boolean(busy) || (!ready && !published)}
                  onClick={() => void togglePublished(item)}
                >
                  <span className="supplier-publish-switch" aria-hidden="true"><i /></span>
                  <span>
                    <strong>{publishBusy ? "Menyimpan..." : published ? "Ditampilkan ke user" : "Tidak ditampilkan"}</strong>
                    <small>
                      {published
                        ? "Klik untuk sembunyikan"
                        : item.mapping
                          ? "Klik untuk tampilkan lagi"
                          : "Klik untuk buat katalog otomatis"}
                    </small>
                  </span>
                </button>

                {item.mapping && (
                  <div className="supplier-browser-mapped">
                    <small>Mapping tersimpan</small>
                    <strong>{item.mapping.gameName} · {item.mapping.label}</strong>
                    <code>{item.mapping.productId}</code>
                  </div>
                )}
              </div>
            </article>
          );
        })}

        {!loading && payload && payload.items.length === 0 && (
          <div className="supplier-browser-loading">
            {payload.latestScanAt
              ? "Tidak ada SKU yang cocok dengan filter."
              : "Belum ada scan Digiflazz. Klik Scan ulang Digiflazz."}
          </div>
        )}
      </section>

      {payload && payload.pages > 1 && (
        <div className="supplier-browser-pagination">
          <button
            type="button"
            disabled={loading || payload.page <= 1}
            onClick={() => void load(payload.page - 1, query, filters, false)}
          >
            ← Sebelumnya
          </button>
          <span>Halaman {payload.page} dari {payload.pages} · {payload.total} SKU hasil filter</span>
          <button
            type="button"
            disabled={loading || payload.page >= payload.pages}
            onClick={() => void load(payload.page + 1, query, filters, false)}
          >
            Berikutnya →
          </button>
        </div>
      )}
    </main>
  );
}
