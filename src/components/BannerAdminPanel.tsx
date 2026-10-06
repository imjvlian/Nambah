"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Banner = {
  id: number;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  promoCode: string | null;
  sortOrder: number;
  displayMode: "carousel" | "popup" | "both";
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
};

const DISPLAY_MODE_LABEL: Record<string, string> = {
  carousel: "Carousel",
  popup: "Pop-up",
  both: "Carousel + Pop-up",
};

type BannersPayload = {
  banners?: Banner[];
  cloudinaryReady?: boolean;
  error?: string;
};

export default function BannerAdminPanel() {
  const [payload, setPayload] = useState<BannersPayload | null>(null);
  const [role, setRole] = useState("");
  const [draft, setDraft] = useState({
    title: "",
    subtitle: "",
    ctaLabel: "",
    ctaHref: "",
    promoCode: "",
    sortOrder: "100",
    displayMode: "carousel",
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const canManage = role === "admin" || role === "superadmin" || role === "legacy";

  async function load() {
    const [bannersResponse, sessionResponse] = await Promise.all([
      fetch("/api/admin/banners", { cache: "no-store" }),
      fetch("/api/admin/session", { cache: "no-store" }),
    ]);

    if (bannersResponse.status === 401 || sessionResponse.status === 401) {
      window.location.replace("/login?next=%2Fadmin%2Fbanners");
      return;
    }

    const bannersData = (await bannersResponse.json()) as BannersPayload;
    const sessionData = (await sessionResponse.json()) as { role?: string };
    if (!bannersResponse.ok) {
      throw new Error(bannersData.error ?? "Banner gagal dimuat.");
    }

    setPayload(bannersData);
    setRole(sessionData.role ?? "");
  }

  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Banner gagal dimuat."),
    );
  }, []);

  async function uploadBanner() {
    if (!file) {
      setNotice("Pilih file gambar dulu.");
      return;
    }
    setBusy("upload");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", draft.title);
      form.set("subtitle", draft.subtitle);
      form.set("ctaLabel", draft.ctaLabel);
      form.set("ctaHref", draft.ctaHref);
      form.set("promoCode", draft.promoCode);
      form.set("sortOrder", draft.sortOrder);
      form.set("displayMode", draft.displayMode);

      const response = await fetch("/api/admin/banners", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Banner gagal diunggah.");
      }
      setDraft({
        title: "",
        subtitle: "",
        ctaLabel: "",
        ctaHref: "",
        promoCode: "",
        sortOrder: "100",
        displayMode: "carousel",
      });
      setFile(null);
      await load();
      setNotice("Banner berhasil diunggah dan langsung aktif.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Banner gagal diunggah.");
    } finally {
      setBusy("");
    }
  }

  async function toggleActive(banner: Banner) {
    setBusy("toggle:" + banner.id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/banners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: banner.id, active: !banner.active }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Banner gagal diperbarui.");
      }
      await load();
      setNotice(`Banner ${banner.title} ${banner.active ? "dinonaktifkan" : "diaktifkan"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Banner gagal diperbarui.");
    } finally {
      setBusy("");
    }
  }

  async function changeDisplayMode(banner: Banner, displayMode: string) {
    setBusy("mode:" + banner.id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/banners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: banner.id, displayMode }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Display mode gagal diubah.");
      }
      await load();
      setNotice(`Banner ${banner.title} kini tampil di: ${DISPLAY_MODE_LABEL[displayMode] ?? displayMode}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Display mode gagal diubah.");
    } finally {
      setBusy("");
    }
  }

  async function deleteBanner(banner: Banner) {
    if (!window.confirm(`Hapus banner "${banner.title}"? Gambar di Cloudinary ikut dihapus.`)) {
      return;
    }
    setBusy("delete:" + banner.id);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/banners?id=${banner.id}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Banner gagal dihapus.");
      }
      await load();
      setNotice(`Banner ${banner.title} dihapus.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Banner gagal dihapus.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="acc-page">
      <section className="acc-workspace" style={{ marginLeft: 0 }}>
        <header className="acc-topbar">
          <div>
            <small>Admin / Konten</small>
            <strong>Promo Banners</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin">← Control Center</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero acc-hero-standalone">
            <div>
              <span className="acc-eyebrow">Homepage carousel</span>
              <h1>Banner promo berjalan, tanpa deploy.</h1>
              <p>
                Upload gambar 1200×400px (JPG/PNG/WebP, maks 2MB). Banner aktif
                langsung tampil di beranda; kalau tidak ada banner, beranda
                menampilkan kartu generic dari promo aktif.
              </p>
            </div>
          </section>

          {notice && (
            <div className="acc-global-notice acc-inline-notice" role="status">
              {notice}
            </div>
          )}

          {payload && payload.cloudinaryReady === false && (
            <div className="testlab-safety-warning">
              <strong>Cloudinary belum dikonfigurasi</strong>
              <span>
                Isi CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan
                CLOUDINARY_API_SECRET di environment server untuk mengaktifkan upload.
              </span>
            </div>
          )}

          <div className="acc-panel">
            <div className="acc-section-head">
              <div>
                <span className="acc-eyebrow">Upload baru</span>
                <h2>Tambah banner.</h2>
              </div>
            </div>

            <div className="testlab-form-grid">
              <label className="acc-field">
                <span>Gambar banner</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <small>JPG/PNG/WebP, maks 2MB. Disarankan 1200×400px.</small>
              </label>

              <label className="acc-field">
                <span>Judul</span>
                <input
                  placeholder="Contoh: Diskon Gajian 10%"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                />
                <small>Wajib, 3–120 karakter.</small>
              </label>

              <label className="acc-field">
                <span>Subjudul</span>
                <input
                  placeholder="Opsional"
                  value={draft.subtitle}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, subtitle: event.target.value }))
                  }
                />
              </label>

              <label className="acc-field">
                <span>Label tombol (CTA)</span>
                <input
                  placeholder="Default: Pakai kode / Top up sekarang"
                  value={draft.ctaLabel}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, ctaLabel: event.target.value }))
                  }
                />
              </label>

              <label className="acc-field">
                <span>Kode promo (opsional)</span>
                <input
                  placeholder="GAJIAN"
                  value={draft.promoCode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      promoCode: event.target.value.toUpperCase(),
                    }))
                  }
                />
                <small>Terisi → klik banner menyalin kode + scroll ke katalog.</small>
              </label>

              <label className="acc-field">
                <span>Link CTA (opsional)</span>
                <input
                  placeholder="https://… (menimpa aksi kode promo)"
                  value={draft.ctaHref}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, ctaHref: event.target.value }))
                  }
                />
              </label>

              <label className="acc-field">
                <span>Tampil di</span>
                <select
                  value={draft.displayMode}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, displayMode: event.target.value }))
                  }
                >
                  <option value="carousel">Carousel beranda</option>
                  <option value="popup">Pop-up beranda</option>
                  <option value="both">Carousel + Pop-up</option>
                </select>
                <small>Pop-up muncul sebagai modal sekali per 24 jam per pengunjung.</small>
              </label>

              <label className="acc-field">
                <span>Urutan</span>
                <input
                  inputMode="numeric"
                  value={draft.sortOrder}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                />
                <small>Angka kecil tampil lebih dulu. Default 100.</small>
              </label>
            </div>

            <div className="acc-action-panel">
              <button
                type="button"
                disabled={
                  busy === "upload" || !canManage || !file || draft.title.trim().length < 3
                }
                onClick={() => void uploadBanner()}
              >
                {busy === "upload" ? "Mengunggah..." : "Upload & aktifkan"}
              </button>
            </div>
          </div>

          <div className="acc-table-card">
            <div className="acc-receipts-head">
              <span>Banner</span>
              <span>CTA</span>
              <span>Tampil di</span>
              <span>Status</span>
              <span>Aksi</span>
            </div>
            {(payload?.banners ?? []).map((banner) => (
              <div className="acc-receipts-row" key={banner.id}>
                <div>
                  <strong>{banner.title}</strong>
                  <span>{banner.subtitle ?? banner.imageUrl.slice(0, 64) + "…"}</span>
                </div>
                <span>{banner.promoCode ?? banner.ctaLabel ?? "-"}</span>
                <select
                  value={banner.displayMode}
                  disabled={!canManage || Boolean(busy)}
                  onChange={(event) => void changeDisplayMode(banner, event.target.value)}
                >
                  {Object.entries(DISPLAY_MODE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className={"acc-status " + (banner.active ? "active" : "inactive")}>
                  {banner.active ? "active" : "inactive"}
                </span>
                <div className="acc-action-panel">
                  <button
                    type="button"
                    disabled={!canManage || Boolean(busy)}
                    onClick={() => void toggleActive(banner)}
                  >
                    {busy === "toggle:" + banner.id
                      ? "..."
                      : banner.active
                        ? "Nonaktifkan"
                        : "Aktifkan"}
                  </button>
                  <button
                    type="button"
                    disabled={!canManage || Boolean(busy)}
                    onClick={() => void deleteBanner(banner)}
                  >
                    {busy === "delete:" + banner.id ? "Menghapus..." : "Hapus"}
                  </button>
                </div>
              </div>
            ))}
            {payload && (payload.banners ?? []).length === 0 && (
              <div className="acc-empty">
                Belum ada banner — beranda menampilkan kartu generic promo/USP.
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
