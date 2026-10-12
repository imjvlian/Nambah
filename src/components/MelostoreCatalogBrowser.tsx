"use client";

import { FormEvent, useEffect, useState } from "react";
import CollapsiblePanel from "@/components/admin/CollapsiblePanel";

/**
 * Browser katalog Melostore.
 *
 * MIRROR DARI BROWSER DIGIFLAZZ, BUKAN SALINANNYA
 *
 * Digiflazz punya alur publish (centang → jual). Melostore memakai alur
 * "tambahkan produk": pilih SKU → jadi draft internal → dipetakan. Alurnya
 * beda karena peran supplier-nya beda: Digiflazz adalah sumber katalog,
 * Melostore adalah tambahannya. Jadi komponennya terpisah meski memakai
 * kelas dan pola tabel yang sama.
 */

type CatalogRow = {
  sku: string;
  name: string;
  category: string;
  brand: string | null;
  type: string;
  cost: number;
  active: boolean;
  lastSeenAt: string;
  added: boolean;
  gameId: string;
  gameName: string;
  gameConfident: boolean;
  inquiryFormKey: string | null;
  inquiryFields: Array<{ key: string; name: string; type: string }> | null;
  inquiryNotice: string | null;
  internalProduct: {
    id: string;
    label: string;
    internalSku: string | null;
    active: boolean;
    sellingPrice: number;
  } | null;
};

type GroupCounts = {
  total: number;
  tersedia: number;
  ditambahkan: number;
};

type CatalogPayload = {
  rows: CatalogRow[];
  total: number;
  page: number;
  totalPages: number;
  categories: string[];
  brands: string[];
  games: Array<{ id: string; name: string }>;
  groups: Record<string, Record<string, GroupCounts>>;
  addedCount: number;
  scan: {
    lastRun: {
      status: string;
      startedAt: string;
      finishedAt: string | null;
      found: number | null;
      baru: number | null;
      updated: number | null;
      pagesFailed: number | null;
      error: string | null;
    } | null;
    lastSuccessAt: string | null;
  };
};

function rupiah(value: number) {
  return "Rp " + Math.round(value).toLocaleString("id-ID");
}

export default function MelostoreCatalogBrowser() {
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [kategori, setKategori] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [gameFilter, setGameFilter] = useState("");
  const [tersedia, setTersedia] = useState("");
  const [mapping, setMapping] = useState("");
  const [page, setPage] = useState(1);

  // Grup yang dipilih untuk navigasi (kategori + brand) - chip di atas tabel
  const [pilihKategori, setPilihKategori] = useState("");
  const [pilihBrand, setPilihBrand] = useState("");

  /*
   * Form tambah per baris: hanya muncul pada baris yang ditekan tombolnya.
   * Satu state { sku, gameId, label } - bukan per-kolom - supaya menutup
   * form berarti mengosongkan satu kunci.
   */
  const [tambah, setTambah] = useState<{
    sku: string;
    gameId: string;
    label: string;
  } | null>(null);

  async function load(
    nextQuery = query,
    nextKategori = kategori,
    nextBrand = brandFilter,
    nextGame = gameFilter,
    nextTersedia = tersedia,
    nextMapping = mapping,
    nextPage = page,
  ) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextKategori) params.set("kategori", nextKategori);
    if (nextBrand) params.set("brand", nextBrand);
    if (nextGame) params.set("game", nextGame);
    if (nextTersedia) params.set("tersedia", nextTersedia);
    if (nextMapping) params.set("mapping", nextMapping);
    params.set("page", String(nextPage));
    params.set("pageSize", "25");

    try {
      const response = await fetch(
        "/api/admin/melostore/catalog?" + params.toString(),
        { cache: "no-store" },
      );
      const payload = (await response.json()) as CatalogPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Katalog gagal dimuat.");
      setData(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Katalog gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("", "", "", "", "", "", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pilih grup dari panel navigasi (kategori + brand) -> set filter dan reset page
  function pilihGrup(kat: string, brand?: string) {
    setPilihKategori(kat);
    setPilihBrand(brand ?? "");
    setKategori(kat);
    setBrandFilter(brand ?? "");
    setPage(1);
    void load(query, kat, brand ?? "", gameFilter, tersedia, mapping, 1);
  }

  // Hapus pilihan grup -> kembali ke semua
  function hapusPilihGrup() {
    setPilihKategori("");
    setPilihBrand("");
    setKategori("");
    setBrandFilter("");
    setPage(1);
    void load(query, "", "", gameFilter, tersedia, mapping, 1);
  }

  async function scan() {
    setBusy("scan");
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cache-catalog" }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? "Scan gagal.");
      setNotice(data.message ?? "Scan selesai.");
      setPage(1);
      await load(query, kategori, brandFilter, gameFilter, tersedia, mapping, 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Scan gagal.");
    } finally {
      setBusy("");
    }
  }

  async function tambahkan() {
    if (!tambah) return;
    setBusy("add:" + tambah.sku);
    setNotice("");
    try {
      const response = await fetch("/api/admin/melostore/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tambah),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        product?: { internalSku: string | null; active: boolean };
        digiflazz?: { autoMappedSku: string | null; candidates: Array<{ sku: string; cost: number }> };
      };
      if (!response.ok) throw new Error(data.error ?? "Produk gagal ditambahkan.");

      setNotice(
        (data.message ?? "Produk ditambahkan.") +
          (data.product?.active === false
            ? " Status draft - aktifkan lewat menu Produk setelah harga diisi."
            : ""),
      );
      setTambah(null);
      await load(query, kategori, brandFilter, gameFilter, tersedia, mapping, page);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Produk gagal ditambahkan.");
    } finally {
      setBusy("");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = queryInput.trim();
    setQuery(next);
    setPage(1);
    void load(next, kategori, brandFilter, gameFilter, tersedia, mapping, 1);
  }

  const infoScan = data?.scan.lastRun ?? null;

  return (
    <div>
      <div className="acc-action-panel">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void scan()}
        >
          {busy === "scan" ? "Memindai..." : "Scan katalog"}
        </button>
      </div>

      {notice ? (
        <div className="acc-global-notice acc-inline-notice" role="status">
          {notice}
        </div>
      ) : null}

      {infoScan ? (
        <div className="acc-module-summary">
          <article>
            <small>Scan terakhir</small>
            <strong>{labelStatus(infoScan.status)}</strong>
            <span>{waktu(infoScan.startedAt)}</span>
          </article>
          <article>
            <small>Produk ditemukan</small>
            <strong>{infoScan.found ?? "-"}</strong>
            <span>
              {infoScan.baru ?? 0} baru, {infoScan.updated ?? 0} diperbarui
            </span>
          </article>
          <article>
            <small>Berhasil penuh terakhir</small>
            <strong>{waktu(data?.scan.lastSuccessAt ?? null)}</strong>
            <span>
              {infoScan.pagesFailed
                ? `${infoScan.pagesFailed} halaman gagal - hasil parsial`
                : "Tidak ada halaman yang gagal"}
            </span>
          </article>
        </div>
      ) : null}

      {/* Panel navigasi grup: kategori -> brand asli (collapsible, default tertutup) */}
      <CollapsiblePanel
        title="Jelajahi per kategori"
        description="Klik kategori → brand untuk menyaring tabel. Badge: total / tersedia / sudah ditambahkan."
        defaultOpen={false}
      >
        <div className="acc-catalog-groups">
          {(data?.categories ?? []).map((kat) => {
            const brandMap = data?.groups?.[kat] ?? {};
            return (
              <div key={kat} className="acc-group-row">
                <div className="acc-group-kategori">
                  <strong>{kat}</strong>
                  <span className="acc-group-badge">
                    {Object.values(brandMap).reduce((a, b) => a + b.total, 0)} SKU
                  </span>
                </div>
                <div className="acc-group-games">
                  {Object.entries(brandMap)
                    .sort(([a], [b]) => a.localeCompare(b, "id"))
                    .map(([brand, counts]) => (
                      <button
                        key={brand}
                        type="button"
                        className={`acc-group-game-btn ${pilihKategori === kat && pilihBrand === brand ? "active" : ""}`}
                        onClick={() => pilihGrup(kat, brand)}
                        title={`${counts.total} total · ${counts.tersedia} tersedia · ${counts.ditambahkan} ditambahkan`}
                      >
                        {brand}
                        <span className="acc-group-game-count">
                          {counts.ditambahkan > 0 ? `+${counts.ditambahkan}` : ""}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsiblePanel>

      {/* Chip grup aktif */}
      {(pilihKategori || pilihBrand) && (
        <div className="acc-group-chip">
          <span>
            {pilihKategori}{pilihBrand ? " \u2192 " + pilihBrand : ""}
          </span>
          <button type="button" onClick={hapusPilihGrup} aria-label="Hapus filter grup">
            {"\u2717"}
          </button>
        </div>
      )}

      <div className="acc-filterbar">
        <label className="acc-field acc-tx-search">
          <span>Cari nama atau SKU</span>
          <form onSubmit={submitSearch}>
            <input
              value={queryInput}
              placeholder="mis. Diamonds atau mlid50d"
              onChange={(event) => setQueryInput(event.target.value)}
            />
            <button type="submit">Cari</button>
          </form>
        </label>

        <label className="acc-field">
          <span>Kategori</span>
          <select
            value={kategori}
            onChange={(event) => {
              const next = event.target.value;
              setKategori(next);
              setPage(1);
              void load(query, next, brandFilter, gameFilter, tersedia, mapping, 1);
            }}
          >
            <option value="">Semua kategori</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="acc-field">
          <span>Brand</span>
          <select
            value={brandFilter}
            onChange={(event) => {
              const next = event.target.value;
              setBrandFilter(next);
              setPage(1);
              void load(query, kategori, next, gameFilter, tersedia, mapping, 1);
            }}
          >
            <option value="">Semua brand</option>
            {(data?.brands ?? []).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="acc-field">
          <span>Game</span>
          <select
            value={gameFilter}
            onChange={(event) => {
              const next = event.target.value;
              setGameFilter(next);
              setPage(1);
              void load(query, kategori, brandFilter, next, tersedia, mapping, 1);
            }}
          >
            <option value="">Semua game</option>
            {(data?.games ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <label className="acc-field">
          <span>Ketersediaan</span>
          <select
            value={tersedia}
            onChange={(event) => {
              const next = event.target.value;
              setTersedia(next);
              setPage(1);
              void load(query, kategori, brandFilter, gameFilter, next, mapping, 1);
            }}
          >
            <option value="">Semua</option>
            <option value="active">Tersedia</option>
            <option value="inactive">Tidak tersedia</option>
          </select>
        </label>

        <label className="acc-field">
          <span>Status mapping</span>
          <select
            value={mapping}
            onChange={(event) => {
              const next = event.target.value;
              setMapping(next);
              setPage(1);
              void load(query, kategori, brandFilter, gameFilter, tersedia, next, 1);
            }}
          >
            <option value="">Semua</option>
            <option value="added">Sudah ditambahkan</option>
            <option value="unmapped">Belum ditambahkan</option>
          </select>
        </label>
      </div>

      <div className="acc-table-card" style={{ marginTop: 12 }}>
        <div className="acc-receipts-head is-mapping">
          <span>Produk Melostore</span>
          <span>Brand</span>
          <span>Kategori</span>
          <span>Modal</span>
          <span>Status</span>
          <span>Aksi</span>
        </div>

        {(data?.rows ?? []).map((row) => {
          // Gunakan info game dari server (sudah dihitung di API) - tidak perlu tebakGame client-side
          const sedangTambah = tambah?.sku === row.sku;

          return (
            <div className="acc-receipts-row is-mapping" key={row.sku}>
              <div>
                <strong>{row.name}</strong>
                <span>{row.sku}</span>
                {row.inquiryFields && row.inquiryFields.length > 0 ? (
                  <span className="acc-form-fields">
                    {row.inquiryFields.map((f) => (
                      <em key={f.key} title={`Input ${f.name} (kunci: ${f.key})`}>
                        {f.name}
                      </em>
                    ))}
                  </span>
                ) : null}
                {row.inquiryNotice ? (
                  <small className="acc-form-notice">{row.inquiryNotice}</small>
                ) : null}
              </div>
              <span className="acc-cell-game">
                {row.brand ?? "Tanpa brand"}
                <small className="acc-cell-game-sub">
                  {row.gameName}
                  {!row.gameConfident && row.gameId ? " (ambigu)" : ""}
                </small>
              </span>
              <span>{row.category}</span>
              <span>{rupiah(row.cost)}</span>

              <div>
                <span className={"acc-status " + (row.active ? "active" : "inactive")}>
                  {row.active ? "Tersedia" : "Tidak tersedia"}
                </span>
                {row.added ? (
                  <small>
                    Sudah ditambahkan: {row.internalProduct?.label}
                    {row.internalProduct?.internalSku
                      ? ` (${row.internalProduct.internalSku})`
                      : ""}
                  </small>
                ) : null}
              </div>

              <div className="acc-action-panel">
                {row.added ? (
                  <small>Sudah di katalog</small>
                ) : sedangTambah ? (
                  <div className="acc-field">
                    <label>
                      <span>Game</span>
                      <select
                        value={tambah.gameId}
                        onChange={(event) =>
                          setTambah({ ...tambah, gameId: event.target.value })
                        }
                      >
                        <option value="auto">
                          Buat otomatis: {row.brand ?? "(brand kosong)"}
                        </option>
                        <option value="">Pilih game yang sudah ada...</option>
                        {(data?.games ?? []).map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      {tambah.gameId === "auto" && (
                        <small className="acc-form-notice">
                          {"Game dicari dari brand \"" + (row.brand ?? "") + "\"; bila belum ada, dibuat baru dengan pengaturan dari form input produk ini."}
                        </small>
                      )}
                    </label>
                    <label>
                      <span>Nama produk</span>
                      <input
                        value={tambah.label}
                        onChange={(event) =>
                          setTambah({ ...tambah, label: event.target.value })
                        }
                      />
                    </label>
                    <div className="acc-action-panel" style={{ marginBottom: 0 }}>
                      <button
                        type="button"
                        disabled={Boolean(busy) || !tambah.gameId || !tambah.label}
                        onClick={() => void tambahkan()}
                      >
                        {busy === "add:" + row.sku ? "Membuat..." : "Buat draft"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => setTambah(null)}
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setTambah({
                        sku: row.sku,
                        // Prefiks jelas -> game tebakan; tidak -> brand asli
                        // (bisa membuat game baru otomatis di server).
                        gameId: row.gameConfident ? row.gameId : "auto",
                        label: row.name,
                      })
                    }
                    title={
                      row.gameConfident
                        ? "Tambahkan sebagai draft internal"
                        : "Game dari brand asli - dibuat otomatis bila belum ada"
                    }
                  >
                    Tambahkan Produk
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {(data?.rows ?? []).length === 0 ? (
          <div className="acc-empty">Tidak ada SKU pada saringan ini.</div>
        ) : null}
      </div>

      {data && data.totalPages > 1 ? (
        <div className="acc-tx-pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              const next = page - 1;
              setPage(next);
              void load(query, kategori, brandFilter, gameFilter, tersedia, mapping, next);
            }}
          >
            Sebelumnya
          </button>
          <span className="acc-tx-pageinfo">
            Halaman {page} dari {data.totalPages} ({data.total} SKU)
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              void load(query, kategori, brandFilter, gameFilter, tersedia, mapping, next);
            }}
          >
            Berikutnya
          </button>
        </div>
      ) : null}
    </div>
  );
}

function labelStatus(status: string) {
  switch (status) {
    case "running":
      return "Berjalan";
    case "success":
      return "Berhasil";
    case "partial":
      return "Berhasil sebagian";
    default:
      return "Gagal";
  }
}

function waktu(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}