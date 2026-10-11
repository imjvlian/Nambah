"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

/**
 * Panel pemetaan supplier Melostore.
 *
 * TIGA KEGIATAN, dipisah jelas karena punya konsekuensi berbeda
 *
 * 1. Cek status - membaca katalog Melostore dan menghitung berapa
 *    produk yang sudah dipetakan, ambigu, atau bentrok label.
 *
 * 2. Pasang otomatis - HANYA pasangan yang pencocokan deems pasti.
 *    Ambigu wilayah dan label bentrok dilewati, dan jumlahnya
 *    dilaporkan - bukan diam-diam dilewati.
 *
 * 3. Petakan manual - operator memilih SKU dari kandidat untuk produk
 *    yang otomatis tidak bisa memutuskan.
 *
 * KENAPA KANDIDAT DITAMPILKAN, BUKAN PILIHAN SATU-SATUNYA
 *
 * "50 Diamonds" ada di Melostore sebagai minimal tiga SKU: Indonesia,
 * global, dan varian server. Menampilkan satu dropdown berarti operator
 * menebak wilayah - dan top up yang salah wilayah tidak bisa ditarik.
 * Semua kandidat ditampilkan beserta harganya supaya pilihan dibuat
 * dengan informasi, bukan tebakan.
 */

type ScanRunView = {
  id: number;
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  pages: number | null;
  pagesFailed: number | null;
  found: number | null;
  baru: number | null;
  updated: number | null;
  unchanged: number | null;
  deactivated: number | null;
  error: string | null;
  triggeredBy: string | null;
};

type ScanStatusPayload = {
  runs: ScanRunView[];
  lastSuccessAt: string | null;
};

function waktuLokal(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

function labelStatusScan(status: ScanRunView["status"]) {
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

type Candidate = { sku: string; name: string; cost: number };

type MappingRow = {
  productId: string;
  label: string;
  gameId: string;
  gameName: string;
  eligible: boolean;
  mappedSku: string | null;
  mappedCost: number | null;
  autoSku: string | null;
  autoCost: number | null;
  autoConfidence: string;
  autoReason: string;
  candidates: Candidate[];
  conflictCount: number;
};

type MappingPayload = {
  supplier: {
    id: string;
    label: string;
    configured: boolean;
    catalogSize: number;
    error: string | null;
  };
  games: Array<{ id: string; name: string; meloPrefixes: string[] }>;
  rows: MappingRow[];
  summary: {
    total: number;
    mapped: number;
    autoExact: number;
    ambiguous: number;
    conflict: number;
    notEligible: number;
  };
};

type TabKey = "mapped" | "auto" | "ambiguous" | "conflict" | "unmapped";

const REASON_LABEL: Record<string, string> = {
  matched: "cocok",
  "game-not-allowed": "di luar daftar game",
  "label-not-found": "SKU tidak ada di Melostore",
  "no-candidate-supplier": "SKU ada, tapi milik game lain",
  "multiple-supplier-sku": "beberapa SKU cocok - perlu dipilih",
};

const TAB_LABEL: Record<TabKey, string> = {
  mapped: "Terpetakan",
  auto: "Bisa dipasang",
  ambiguous: "Perlu dipilih",
  conflict: "Label bentrok",
  unmapped: "Belum dipetakan",
};

function rupiah(value: number) {
  return "Rp " + Math.round(value).toLocaleString("id-ID");
}

export default function MelostoreMappingPanel() {
  const [payload, setPayload] = useState<MappingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const [tab, setTab] = useState<TabKey>("auto");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState("");
  const [draf, setDraf] = useState<Record<string, string>>({});
  const [scanRuns, setScanRuns] = useState<ScanStatusPayload | null>(null);

  async function load(nextQuery = query, nextGame = gameFilter) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextGame) params.set("game", nextGame);

    try {
      const response = await fetch(
        "/api/admin/digiflazz/melostore-mapping?" + params.toString(),
        { cache: "no-store" },
      );
      if (response.status === 401) {
        setUnauthorized(true);
        return;
      }
      const data = (await response.json()) as MappingPayload & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Data pemetaan gagal dimuat.");
      }
      setPayload(data);
      setDraf({});
      void muatStatusScan();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Data gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function muatStatusScan() {
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-sync", {
        cache: "no-store",
      });
      if (!response.ok) return;
      setScanRuns((await response.json()) as ScanStatusPayload);
    } catch {
      // Status scan gagal dimuat bukan alasan menggagalkan halaman -
      // tabel pemetaan tetap bisa dipakai.
    }
  }

  async function jalankan(aksi: string, body: Record<string, unknown>, label: string) {
    setBusy(aksi);
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? label + " gagal.");
      }
      setNotice(data.message ?? label + " selesai.");
      await load(query, gameFilter);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : label + " gagal.");
    } finally {
      setBusy("");
    }
  }

  async function pasangOtomatis() {
    setBusy("auto");
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply-auto" }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? "Pemasangan otomatis gagal.");
      setNotice(data.message ?? "Pemasangan otomatis selesai.");
      await load(query, gameFilter);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pemasangan otomatis gagal.");
    } finally {
      setBusy("");
    }
  }

  async function isiSkuInternal() {
    setBusy("internal-sku");
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-sku" }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? "Pengisian SKU internal gagal.");
      setNotice(data.message ?? "SKU internal selesai diisi.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pengisian SKU internal gagal.");
    } finally {
      setBusy("");
    }
  }

  async function pasangManual(productId: string, sku: string) {
    if (!sku) return;
    setBusy("apply:" + productId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", productId, sku }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Pemetaan gagal disimpan.");

      const row = payload?.rows.find((r) => r.productId === productId);
      setDraf((current) => {
        const next = { ...current };
        delete next[productId];
        return next;
      });
      setNotice(
        row
          ? `${row.label} dipetakan ke ${sku}.`
          : "Pemetaan disimpan.",
      );
      await load(query, gameFilter);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pemetaan gagal disimpan.");
    } finally {
      setBusy("");
    }
  }

  async function hapusMapping(productId: string) {
    setBusy("clear:" + productId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", productId }),
      });
      if (!response.ok) throw new Error("Pemetaan gagal dihapus.");
      setNotice("Pemetaan dihapus.");
      await load(query, gameFilter);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pemetaan gagal dihapus.");
    } finally {
      setBusy("");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = queryInput.trim();
    setQuery(next);
    void load(next, gameFilter);
  }

  const baris = useMemo(() => {
    const rows = payload?.rows ?? [];
    switch (tab) {
      case "mapped":
        return rows.filter((r) => r.mappedSku);
      case "auto":
        return rows.filter(
          (r) => r.autoConfidence === "exact" && !r.mappedSku && r.conflictCount === 0,
        );
      case "ambiguous":
        return rows.filter(
          (r) => r.autoReason === "multiple-supplier-sku" && !r.mappedSku,
        );
      case "conflict":
        return rows.filter((r) => r.conflictCount > 0 && !r.mappedSku);
      default:
        return rows.filter(
          (r) => !r.mappedSku && r.autoConfidence !== "exact",
        );
    }
  }, [payload, tab]);

  if (unauthorized) {
    return (
      <main className="supplier-browser-shell clean-catalog">
        <section className="supplier-browser-empty">
          Sesi admin berakhir. Masuk lagi untuk memetakan supplier.
        </section>
      </main>
    );
  }

  const ringkas = payload?.summary;

  return (
    <main className="acc-page-sub">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            <small>Admin / Katalog</small>
            <strong>Pemetaan Melostore</strong>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero acc-hero-standalone">
            <div>
              <span className="acc-eyebrow">Supplier kedua</span>
              <h1>Satu produk, dua pilihan supplier.</h1>
              <p>
                Order memilih supplier termurah yang saldonya cukup. Pemetaan
                di bawah menentukan produk mana yang punya pasangan Melostore -
                sisanya tetap memakai Digiflazz seperti sebelumnya.
              </p>
            </div>
          </section>

          {scanRuns && scanRuns.runs.length > 0 ? (
            <div className="acc-module-summary">
              <article>
                <small>Scan terakhir</small>
                <strong>{labelStatusScan(scanRuns.runs[0].status)}</strong>
                <span>{waktuLokal(scanRuns.runs[0].startedAt)}</span>
              </article>
              <article>
                <small>Produk ditemukan</small>
                <strong>{scanRuns.runs[0].found ?? "-"}</strong>
                <span>
                  {scanRuns.runs[0].baru ?? 0} baru, {scanRuns.runs[0].updated ?? 0} diperbarui
                </span>
              </article>
              <article>
                <small>Berhasil penuh terakhir</small>
                <strong>{waktuLokal(scanRuns.lastSuccessAt)}</strong>
                <span>
                  {scanRuns.runs[0].pagesFailed
                    ? `${scanRuns.runs[0].pagesFailed} halaman gagal di scan terakhir`
                    : "Tidak ada halaman yang gagal"}
                </span>
              </article>
            </div>
          ) : null}

          {notice ? (
            <div className="acc-global-notice acc-inline-notice" role="status">
              {notice}
            </div>
          ) : null}

          {loading ? (
            <div className="acc-empty">Memuat katalog Melostore...</div>
          ) : null}

          {payload && !payload.supplier.configured ? (
            <div className="testlab-safety-warning">
              <strong>Kredensial Melostore belum diisi</strong>
              <span>
                Isi MELOSTORE_API_KEY dan MELOSTORE_SECRET_KEY untuk memakai
                pemetaan. Pemetaan yang sudah ada tetap bisa dihapus.
              </span>
            </div>
          ) : null}

          {payload?.supplier.error && payload.supplier.configured ? (
            <div className="testlab-safety-warning">
              <strong>Katalog Melostore tidak bisa dimuat</strong>
              <span>
                {payload.supplier.error} Pemetaan manual tetap bisa dipakai -
                ketik SKU-nya langsung.
              </span>
            </div>
          ) : null}

          {ringkas ? (
            <div className="acc-module-summary">
              <article>
                <small>Terpetakan</small>
                <strong>{ringkas.mapped}</strong>
                <span>dari {ringkas.total} produk</span>
              </article>
              <article>
                <small>Bisa dipasang</small>
                <strong>{ringkas.autoExact}</strong>
                <span>cocok pasti, belum dipetakan</span>
              </article>
              <article>
                <small>Perlu dipilih</small>
                <strong>{ringkas.ambiguous}</strong>
                <span>beberapa SKU wilayah</span>
              </article>
              <article>
                <small>Label bentrok</small>
                <strong>{ringkas.conflict}</strong>
                <span>produk lain memakai label sama</span>
              </article>
            </div>
          ) : null}

          <div className="acc-panel">
            <div className="acc-section-head">
              <div>
                <span className="acc-eyebrow">Sinkronisasi</span>
                <h2>Periksa dan pasang.</h2>
              </div>
              <div className="acc-action-panel">
                <button
                  type="button"
                  disabled={Boolean(busy) || !payload?.supplier.configured}
                  onClick={() =>
                    void jalankan("balance", { action: "balance" }, "Pembaruan saldo")
                  }
                >
                  {busy === "balance" ? "Membaca..." : "Perbarui saldo"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || !payload?.supplier.configured}
                  onClick={() =>
                    void jalankan(
                      "catalog",
                      { action: "catalog" },
                      "Sinkron harga",
                    )
                  }
                >
                  {busy === "catalog" ? "Menyinkron..." : "Sinkron harga"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || !payload?.supplier.configured}
                  onClick={() =>
                    void jalankan(
                      "cache-catalog",
                      { action: "cache-catalog" },
                      "Cache katalog Melostore",
                    )
                  }
                >
                  {busy === "cache-catalog" ? "Menyimpan katalog..." : "Cache katalog"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || !payload?.supplier.configured}
                  onClick={() => void pasangOtomatis()}
                >
                  {busy === "auto" ? "Memasang..." : "Pasang otomatis"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void isiSkuInternal()}
                >
                  {busy === "internal-sku" ? "Mengisi..." : "Isi SKU internal"}
                </button>
              </div>
            </div>

            <div className="acc-card-head-note">
              <small>
                Urutan yang benar: "Cache katalog" dulu, lalu "Pasang
                otomatis". Dropdown di editor produk membaca cache, bukan
                API - tarif katalog Melostore hanya 20 permintaan/menit.
                "Sinkron harga" hanya memperbarui pemetaan yang sudah ada.
                "Pasang otomatis" hanya memasang pasangan yang benar-benar
                pasti - yang ambigu dilewati dan dilaporkan jumlahnya, bukan
                ditebak. "Isi SKU internal" mengisi produk yang belum punya,
                dan tidak pernah mengubah SKU yang sudah ada.
              </small>
            </div>
          </div>

          {payload ? (
            <div className="acc-panel">
              <div className="acc-filterbar">
                <label className="acc-field acc-tx-search">
                  <span>Cari produk</span>
                  <form onSubmit={submitSearch}>
                    <input
                      value={queryInput}
                      placeholder="mis. 50 Diamonds"
                      onChange={(event) => setQueryInput(event.target.value)}
                    />
                    <button type="submit">Cari</button>
                  </form>
                </label>

                <label className="acc-field">
                  <span>Game</span>
                  <select
                    value={gameFilter}
                    onChange={(event) => {
                      const next = event.target.value;
                      setGameFilter(next);
                      void load(query, next);
                    }}
                  >
                    <option value="">Semua game</option>
                    {payload.games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                        {g.meloPrefixes.length === 0 ? " (tanpa SKU Melostore)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="acc-segmented" role="group" aria-label="Saring pemetaan">
                {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={tab === key}
                    className={tab === key ? "active" : ""}
                    onClick={() => setTab(key)}
                  >
                    {TAB_LABEL[key]}
                  </button>
                ))}
              </div>

              <div className="acc-table-card" style={{ marginTop: 12 }}>
                <div className="acc-receipts-head is-mapping">
                  <span>Produk</span>
                  <span>Game</span>
                  <span>Status</span>
                  <span>SKU Melostore</span>
                  <span>Aksi</span>
                </div>

                {baris.map((row) => (
                  <div className="acc-receipts-row is-mapping" key={row.productId}>
                    <div>
                      <strong>{row.label}</strong>
                      <span>{row.productId}</span>
                    </div>
                    <span>{row.gameName}</span>

                    <div>
                      <span className={"acc-status " + statusTone(row)}>
                        {row.mappedSku
                          ? "Terpetakan"
                          : !row.eligible
                            ? "Di luar daftar game"
                            : (REASON_LABEL[row.autoReason] ?? row.autoReason)}
                      </span>
                      {row.conflictCount > 0 ? (
                        <small>
                          {row.conflictCount} produk lain memakai label sama.
                          {row.mappedSku
                            ? " Pemetaan ini manual."
                            : " Tidak dipasang otomatis."}
                        </small>
                      ) : null}
                    </div>

                    <div>
                      {row.mappedSku ? (
                        <span>
                          <strong>{row.mappedSku}</strong>
                          <span>{row.mappedCost !== null ? rupiah(row.mappedCost) : "-"}</span>
                        </span>
                      ) : row.candidates.length > 0 ? (
                        <span>
                          <select
                            value={draf[row.productId] ?? ""}
                            onChange={(event) =>
                              setDraf((current) => ({
                                ...current,
                                [row.productId]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Pilih SKU...</option>
                            {row.candidates.map((c) => (
                              <option key={c.sku} value={c.sku}>
                                {c.sku} - {c.name} - {rupiah(c.cost)}
                              </option>
                            ))}
                          </select>
                          {row.autoSku && row.autoSku !== (draf[row.productId] ?? "") ? (
                            <small>
                              Pencocokan menyarankan {row.autoSku}
                              {row.autoCost !== null ? ` (${rupiah(row.autoCost)})` : ""}.
                            </small>
                          ) : null}
                        </span>
                      ) : (
                        <span>
                          <small>Tidak ada kandidat dari katalog Melostore.</small>
                        </span>
                      )}
                    </div>

                    <div className="acc-action-panel">
                      {row.mappedSku ? (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void hapusMapping(row.productId)}
                        >
                          {busy === "clear:" + row.productId ? "Menghapus..." : "Hapus"}
                        </button>
                      ) : row.candidates.length > 0 ? (
                        <button
                          type="button"
                          disabled={Boolean(busy) || !(draf[row.productId] ?? "")}
                          onClick={() =>
                            void pasangManual(row.productId, draf[row.productId])
                          }
                        >
                          {busy === "apply:" + row.productId ? "Menyimpan..." : "Simpan"}
                        </button>
                      ) : (
                        <small>Tidak bisa dipetakan</small>
                      )}
                    </div>
                  </div>
                ))}

                {baris.length === 0 ? (
                  <div className="acc-empty">
                    Tidak ada produk di saringan ini.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function statusTone(row: MappingRow) {
  if (row.mappedSku) return "active";
  if (!row.eligible) return "inactive";
  if (row.autoConfidence === "exact") return "active";
  if (row.autoReason === "multiple-supplier-sku") return "processing";
  return "failed";
}