"use client";

import { useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";
import { useConfirm } from "@/components/AdminConfirmDialog";

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

type PurgeResult = {
  mode: "preview" | "applied";
  summary: {
    candidates: number;
    deletable: number;
    skipped: number;
    deleted: number;
  };
  deletable: Array<{
    id: string;
    gameId: string;
    label: string;
  }>;
  skipped: Array<{
    id: string;
    gameId: string;
    label: string;
    reason: string;
  }>;
};

export default function AdminCatalogTools() {
  const [visible, setVisible] = useState(false);
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [sellingMarkup, setSellingMarkup] = useState("5");
  const [referenceMarkup, setReferenceMarkup] = useState("10");
  const [gameId, setGameId] = useState("all");
  const [scope, setScope] = useState("ready");
  const [busy, setBusy] = useState("");
  const confirm = useConfirm();
  const [notice, setNotice] = useState("");
  const [markupResult, setMarkupResult] = useState<MarkupResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);

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
      const confirmed = await confirm({
        title: "Terapkan auto mark-up?",
        description:
          "Harga manual produk target akan diganti oleh rumus otomatis, jadi cek dulu hasil dry-run.",
        details: [
          {
            label: "Produk terdampak",
            value: targetCount ? String(targetCount) : "produk yang sesuai",
          },
          { label: "Cakupan", value: selectedGameName },
        ],
        confirmLabel: "Terapkan mark-up",
      });
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
      const confirmed = await confirm({
        title: `Bersihkan ${activeCount} produk tanpa mapping?`,
        description:
          "Produk tidak dihapus: produk orphan akan disembunyikan dan game kosong dinonaktifkan.",
        confirmLabel: "Bersihkan katalog",
      });
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

  async function runPurge(dryRun: boolean) {
    if (!dryRun) {
      const deletableCount = purgeResult?.summary.deletable ?? 0;
      const skippedCount = purgeResult?.summary.skipped ?? 0;
      const confirmed = await confirm({
        title: `Hapus permanen ${deletableCount} produk?`,
        description: "Aksi ini tidak bisa dibatalkan.",
        tone: "danger",
        details: [
          { label: "Akan dihapus", value: String(deletableCount) },
          {
            label: "Dipertahankan",
            value:
              skippedCount > 0
                ? `${skippedCount} (punya riwayat order)`
                : "—",
          },
        ],
        confirmLabel: "Hapus permanen",
      });
      if (!confirmed) return;
    }

    setBusy(dryRun ? "purge-preview" : "purge-apply");
    setNotice("");

    try {
      const response = await fetch("/api/admin/catalog/unmapped", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = (await response.json()) as PurgeResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Hapus produk unmapped gagal.");

      setPurgeResult(data);
      if (dryRun) {
        setNotice(
          `Preview hapus: ${data.summary.deletable} produk bersih bisa dihapus permanen` +
            (data.summary.skipped > 0
              ? `, ${data.summary.skipped} punya riwayat order dan hanya boleh dinonaktifkan.`
              : "."),
        );
      } else {
        await loadCatalog();
        setNotice(
          `Hapus permanen selesai. ${data.summary.deleted} produk dihapus` +
            (data.summary.skipped > 0
              ? `, ${data.summary.skipped} produk bersejarah tetap disimpan.`
              : "."),
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Hapus produk unmapped gagal.");
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
            Clean menyembunyikan produk orphan agar tidak masuk katalog user, lalu menonaktifkan game yang sudah tidak punya produk aktif mapped. Hapus permanen hanya untuk produk tanpa riwayat order; yang bersejarah otomatis dilewati dan cukup dinonaktifkan.
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

          {purgeResult && (
            <div className="admin-tool-preview cleanup-preview">
              <div><small>Bisa dihapus</small><strong>{purgeResult.summary.deletable}</strong></div>
              <div><small>Bersejarah</small><strong>{purgeResult.summary.skipped}</strong></div>
              <div><small>Terhapus</small><strong>{purgeResult.summary.deleted}</strong></div>
            </div>
          )}

          {purgeResult && purgeResult.skipped.length > 0 ? (
            <div className="admin-cleanup-list">
              {purgeResult.skipped.slice(0, 6).map((product) => (
                <div key={product.id}>
                  <span>{product.label}</span>
                  <code>{product.id} · riwayat order</code>
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

          <div className="admin-tool-actions cleanup-actions">
            <button type="button" onClick={() => void runPurge(true)} disabled={Boolean(busy)}>
              {busy === "purge-preview" ? "Mengecek..." : "Preview hapus permanen"}
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => void runPurge(false)}
              disabled={Boolean(busy) || !purgeResult || purgeResult.mode !== "preview" || purgeResult.summary.deletable === 0}
            >
              {busy === "purge-apply" ? "Menghapus..." : "Hapus permanen"}
            </button>
          </div>
        </article>
      </div>

      {notice && <p className="admin-automation-notice">{notice}</p>}
    </section>
  );
}
