"use client";

import { useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";

type CatalogSnapshot = {
  stats: {
    total: number;
    active: number;
    mapped: number;
    ready: number;
    unmapped: number;
  };
  games: Array<{
    id: string;
    name: string;
    shortName: string;
    active: boolean;
  }>;
};

type MarkupPreviewItem = {
  productId: string;
  gameId: string;
  label: string;
  supplierSku: string;
  supplierCost: number;
  oldSellingPrice: number;
  oldReferencePrice: number;
  sellingPrice: number;
  referencePrice: number;
  changed: boolean;
};

type MarkupResult = {
  mode: "preview" | "applied";
  rules: {
    sellingMarkupPercent: number;
    referenceMarkupPercent: number;
    minimumProfit: number;
    gameId: string | null;
    scope: string;
    rounding: number;
  };
  summary: {
    eligible: number;
    changed: number;
    unchanged: number;
  };
  preview: MarkupPreviewItem[];
};

type CleanupResult = {
  mode: "preview" | "applied";
  summary: {
    orphanProducts: number;
    activeOrphans: number;
    alreadyHidden: number;
    gamesToDisable: number;
  };
  preview: {
    products: Array<{
      id: string;
      gameId: string;
      label: string;
      active: boolean;
    }>;
    games: Array<{
      id: string;
      name: string;
    }>;
  };
};

export default function AdminCatalogTools() {
  const [visible, setVisible] = useState(false);
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [sellingMarkup, setSellingMarkup] = useState("5");
  const [referenceMarkup, setReferenceMarkup] = useState("10");
  const [gameId, setGameId] = useState("all");
  const [scope, setScope] = useState("ready");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [markupResult, setMarkupResult] = useState<MarkupResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);

  async function loadCatalog() {
    const response = await fetch("/api/admin/catalog", { cache: "no-store" });
    if (response.status === 401) return false;
    const data = (await response.json()) as CatalogSnapshot & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Kontrol katalog gagal dimuat.");
    setCatalog(data);
    setVisible(true);
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function probe() {
      try {
        const response = await fetch("/api/admin/session", { cache: "no-store" });
        const session = (await response.json()) as { authenticated?: boolean };
        if (cancelled) return;

        if (session.authenticated) {
          await loadCatalog();
          return;
        }
      } catch {
        // AdminDashboard menangani pesan login/error utama.
      }

      if (!cancelled) timer = setTimeout(() => void probe(), 1800);
    }

    void probe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const sellingPercent = Number(sellingMarkup);
  const referencePercent = Number(referenceMarkup);
  const percentagesValid =
    Number.isFinite(sellingPercent) &&
    sellingPercent >= 0 &&
    sellingPercent <= 500 &&
    Number.isFinite(referencePercent) &&
    referencePercent >= 0 &&
    referencePercent <= 500;

  const selectedGameName = useMemo(() => {
    if (gameId === "all") return "semua game";
    return catalog?.games.find((game) => game.id === gameId)?.name ?? gameId;
  }, [catalog, gameId]);

  async function runMarkup(dryRun: boolean) {
    if (!percentagesValid) {
      setNotice("Mark-up jual dan harga coret harus 0–500%.");
      return;
    }

    if (!dryRun) {
      const targetCount = markupResult?.summary.changed ?? markupResult?.summary.eligible ?? 0;
      const confirmed = window.confirm(
        `Terapkan auto mark-up ke ${targetCount || "produk yang sesuai"} pada ${selectedGameName}? Harga manual produk target akan diganti oleh rumus otomatis.`,
      );
      if (!confirmed) return;
    }

    setBusy(dryRun ? "markup-preview" : "markup-apply");
    setNotice("");

    try {
      const response = await fetch("/api/admin/catalog/markup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun,
          sellingMarkupPercent: sellingPercent,
          referenceMarkupPercent: referencePercent,
          gameId: gameId === "all" ? null : gameId,
          scope,
        }),
      });
      const data = (await response.json()) as MarkupResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Auto mark-up gagal.");

      setMarkupResult(data);
      if (dryRun) {
        setNotice(
          `Preview siap: ${data.summary.eligible} produk eligible, ${data.summary.changed} harga akan berubah. Minimum profit tetap ${formatIDR(data.rules.minimumProfit)}.`,
        );
      } else {
        await loadCatalog();
        setNotice(`Auto mark-up diterapkan ke ${data.summary.changed} produk.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Auto mark-up gagal.");
    } finally {
      setBusy("");
    }
  }

  async function runCleanup(dryRun: boolean) {
    if (!dryRun) {
      const activeCount = cleanupResult?.summary.activeOrphans ?? catalog?.stats.unmapped ?? 0;
      const confirmed = window.confirm(
        `Clean ${activeCount} produk tanpa mapping? Produk tidak dihapus; produk orphan akan disembunyikan dan game kosong akan dinonaktifkan.`,
      );
      if (!confirmed) return;
    }

    setBusy(dryRun ? "cleanup-preview" : "cleanup-apply");
    setNotice("");

    try {
      const response = await fetch("/api/admin/catalog/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = (await response.json()) as CleanupResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Clean katalog gagal.");

      setCleanupResult(data);
      if (dryRun) {
        setNotice(
          `Ditemukan ${data.summary.orphanProducts} produk tanpa mapping; ${data.summary.activeOrphans} masih aktif dan ${data.summary.gamesToDisable} game akan menjadi kosong.`,
        );
      } else {
        await loadCatalog();
        setNotice(
          `Clean selesai. ${data.summary.activeOrphans} produk orphan disembunyikan dan ${data.summary.gamesToDisable} game kosong dinonaktifkan.`,
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Clean katalog gagal.");
    } finally {
      setBusy("");
    }
  }

  if (!visible || !catalog) return null;

  return (
    <section className="admin-automation-shell">
      <div className="admin-automation-heading">
        <div>
          <span className="admin-kicker">Pricing Automation</span>
          <h2>Harga otomatis & cleanup.</h2>
          <p>
            Hitung harga dari modal Digiflazz lalu rapikan produk Nambah yang sudah tidak punya mapping supplier.
          </p>
        </div>
        <span className="admin-automation-count">{catalog.stats.mapped} mapped · {catalog.stats.unmapped} unmapped</span>
      </div>

      <div className="admin-automation-grid">
        <article className="admin-automation-card">
          <div className="admin-automation-card-head">
            <div>
              <small>Auto mark-up</small>
              <strong>Jual + harga coret</strong>
            </div>
            <span>Rp100 rounding</span>
          </div>

          <div className="admin-automation-fields">
            <label>
              <span>Mark-up jual dari modal</span>
              <div className="admin-percent-input">
                <input
                  type="number"
                  min="0"
                  max="500"
                  step="0.1"
                  value={sellingMarkup}
                  onChange={(event) => setSellingMarkup(event.target.value)}
                />
                <b>%</b>
              </div>
            </label>

            <label>
              <span>Mark-up harga coret dari jual</span>
              <div className="admin-percent-input">
                <input
                  type="number"
                  min="0"
                  max="500"
                  step="0.1"
                  value={referenceMarkup}
                  onChange={(event) => setReferenceMarkup(event.target.value)}
                />
                <b>%</b>
              </div>
            </label>

            <label>
              <span>Game</span>
              <select value={gameId} onChange={(event) => setGameId(event.target.value)}>
                <option value="all">Semua game</option>
                {catalog.games.map((game) => (
                  <option key={game.id} value={game.id}>{game.name}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Target produk</span>
              <select value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="ready">Aktif + supplier ready</option>
                <option value="active-mapped">Semua aktif yang mapped</option>
                <option value="mapped">Semua yang mapped</option>
              </select>
            </label>
          </div>

          <div className="admin-formula">
            <span>Jual = max(modal + mark-up, modal + minimum profit)</span>
            <span>Coret = jual + mark-up coret</span>
          </div>

          {markupResult && (
            <div className="admin-tool-preview">
              <div><small>Eligible</small><strong>{markupResult.summary.eligible}</strong></div>
              <div><small>Berubah</small><strong>{markupResult.summary.changed}</strong></div>
              <div><small>Min profit</small><strong>{formatIDR(markupResult.rules.minimumProfit)}</strong></div>
            </div>
          )}

          {markupResult?.preview?.length ? (
            <div className="admin-price-preview-list">
              {markupResult.preview.slice(0, 4).map((item) => (
                <div key={item.productId}>
                  <span>{item.label}</span>
                  <small>{formatIDR(item.supplierCost)} → <b>{formatIDR(item.sellingPrice)}</b> / <s>{formatIDR(item.referencePrice)}</s></small>
                </div>
              ))}
            </div>
          ) : null}

          <div className="admin-tool-actions">
            <button type="button" onClick={() => void runMarkup(true)} disabled={Boolean(busy) || !percentagesValid}>
              {busy === "markup-preview" ? "Menghitung..." : "Preview mark-up"}
            </button>
            <button className="primary" type="button" onClick={() => void runMarkup(false)} disabled={Boolean(busy) || !percentagesValid}>
              {busy === "markup-apply" ? "Menerapkan..." : "Terapkan mark-up"}
            </button>
          </div>
        </article>

        <article className="admin-automation-card cleanup-card">
          <div className="admin-automation-card-head">
            <div>
              <small>Catalog hygiene</small>
              <strong>Clean unmapped</strong>
            </div>
            <span>{catalog.stats.unmapped} terdeteksi</span>
          </div>

          <p className="admin-cleanup-copy">
            Produk tanpa SKU supplier tidak langsung dihapus. Clean menyembunyikan produk orphan agar tidak masuk katalog user, lalu menonaktifkan game yang sudah tidak punya produk aktif mapped.
          </p>

          {cleanupResult && (
            <div className="admin-tool-preview cleanup-preview">
              <div><small>Orphan</small><strong>{cleanupResult.summary.orphanProducts}</strong></div>
              <div><small>Masih aktif</small><strong>{cleanupResult.summary.activeOrphans}</strong></div>
              <div><small>Game kosong</small><strong>{cleanupResult.summary.gamesToDisable}</strong></div>
            </div>
          )}

          {cleanupResult?.preview.products?.length ? (
            <div className="admin-cleanup-list">
              {cleanupResult.preview.products.slice(0, 6).map((product) => (
                <div key={product.id}>
                  <span>{product.label}</span>
                  <code>{product.id}</code>
                </div>
              ))}
            </div>
          ) : null}

          <div className="admin-tool-actions cleanup-actions">
            <button type="button" onClick={() => void runCleanup(true)} disabled={Boolean(busy)}>
              {busy === "cleanup-preview" ? "Mengecek..." : "Preview clean"}
            </button>
            <button className="danger" type="button" onClick={() => void runCleanup(false)} disabled={Boolean(busy)}>
              {busy === "cleanup-apply" ? "Cleaning..." : "Clean unmapped"}
            </button>
          </div>
        </article>
      </div>

      {notice && <p className="admin-automation-notice">{notice}</p>}
    </section>
  );
}
