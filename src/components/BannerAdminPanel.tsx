"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/AdminConfirmDialog";

type Banner = {
  id: number;
  title: string;
  subtitle: string | null;
  popupMessage: string | null;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  promoCode: string | null;
  sortOrder: number;
  displayMode: "carousel" | "popup" | "both";
  showTextOverlay: boolean;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
};

const POPUP_MESSAGE_MAX = 500;

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
    popupMessage: "",
    ctaLabel: "",
    ctaHref: "",
    promoCode: "",
    sortOrder: "100",
    displayMode: "carousel",
    showTextOverlay: true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const confirm = useConfirm();
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
      form.set("popupMessage", draft.popupMessage);
      form.set("ctaLabel", draft.ctaLabel);
      form.set("ctaHref", draft.ctaHref);
      form.set("promoCode", draft.promoCode);
      form.set("sortOrder", draft.sortOrder);
      form.set("displayMode", draft.displayMode);
      form.set("showTextOverlay", String(draft.showTextOverlay));

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
        popupMessage: "",
        ctaLabel: "",
        ctaHref: "",
        promoCode: "",
        sortOrder: "100",
        displayMode: "carousel",
        showTextOverlay: true,
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
        throw new Error(body.error ?? "Lokasi tampil gagal diubah.");
      }
      await load();
      setNotice(`Banner ${banner.title} kini tampil di: ${DISPLAY_MODE_LABEL[displayMode] ?? displayMode}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Lokasi tampil gagal diubah.");
    } finally {
      setBusy("");
    }
  }

  async function toggleTextOverlay(banner: Banner) {
    setBusy("overlay:" + banner.id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/banners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: banner.id,
          showTextOverlay: !banner.showTextOverlay,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Mode tampilan gagal diubah.");
      }
      await load();
      setNotice(
        banner.showTextOverlay
          ? `Banner ${banner.title} kini tampil bersih (tanpa teks).`
          : `Banner ${banner.title} kini menampilkan teks overlay.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Mode tampilan gagal diubah.");
    } finally {
      setBusy("");
    }
  }

  async function deleteBanner(banner: Banner) {
    const confirmed = await confirm({
      title: `Hapus banner "${banner.title}"?`,
      description: "Gambar di Cloudinary ikut dihapus dan tidak bisa dikembalikan.",
      tone: "danger",
      confirmLabel: "Hapus banner",
    });
    if (!confirmed) return;
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
    <main className="acc-page-sub">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            <small>Admin / Konten</small>
            <strong>Banner Promo</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin">← Control Center</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero acc-hero-standalone">
            <div>
              <span className="acc-eyebrow">Carousel beranda</span>
              <h1>Banner promo berjalan, tanpa deploy.</h1>
              <p>
                Upload gambar 1200×400px (JPG/PNG/WebP, maks 2MB). Banner aktif
                langsung tampil di beranda; kalau tidak ada banner, beranda
                menampilkan kartu promo/USP bawaan.
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
                CLOUDINARY_API_SECRET di environment server untuk mengaktifkan unggahan.
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

              {/*
               * Pesan popup.
               *
               * Field terpisah dari `Subjudul` di atas, bukan field yang sama.
               * Alasannya: `Subjudul` dipakai carousel, dan pop-up tidak punya
               * tombol lagi - memakai ulang satu field berarti setiap edit
               * pesan pop-up ikut mengubah isi carousel.
               */}
              <label className="acc-field acc-field-wide">
                <span>Pesan popup</span>
                <textarea
                  rows={3}
                  maxLength={POPUP_MESSAGE_MAX}
                  placeholder="Contoh: Diskon gajian sampai 31 Oktober. Tulis beberapa baris kalau perlu."
                  value={draft.popupMessage}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      popupMessage: event.target.value,
                    }))
                  }
                />
                <small>
                  Tampil di bawah gambar pada pop-up. Baris baru ikut
                  dipertahankan.{" "}
                  {draft.popupMessage.length}/{POPUP_MESSAGE_MAX} karakter.
                  {draft.popupMessage.trim() ? "" : " Kosongkan bila pop-up ingin menampilkan gambar saja."}
                </small>
              </label>

              <label className="acc-field">
                <span>Teks link / tombol</span>
                <input
                  placeholder="Default: Selengkapnya"
                  value={draft.ctaLabel}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, ctaLabel: event.target.value }))
                  }
                />
                <small>
                  Di carousel jadi label tombol. Di pop-up jadi teks link di
                  bawah pesan.
                </small>
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
                <span>Link tujuan (opsional)</span>
                <input
                  type="url"
                  placeholder="https://…"
                  value={draft.ctaHref}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, ctaHref: event.target.value }))
                  }
                />
                <small>
                  Hanya http/https yang diterima. Di carousel jadi tujuan
                  tombol; di pop-up jadi tautan yang dibuka di tab baru.
                </small>
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

              {/*
                Checkbox, tapi bentuknya tetap field biasa.

                Versi lama membungkus `<label>` di dalam `<label>`. Itu
                HTML yang tidak valid: browser akan menutup label luar
                lebih awal, lalu styling `.acc-field` (grid + gap)
                berhenti berlaku tepat di field ini - padahal semua
                field lain di form ini ikut memakainya. Akibatnya satu
                baris ini terlihat berbeda dari yang di atas dan
                bawahnya, tanpa alasan yang bisa ditunjuk.

                Sekarang dua `<label>` terpisah: yang luar untuk
                mengaitkan label teks ke checkbox, yang dalam untuk
                baris toggle dan teksnya. Pola yang sama dipakai
                `acc-checkbox-field` di halaman Toko Ritel.
              */}
              {/*
               * Toggle ini sekarang hanya berlaku untuk carousel.
               *
               * Popup tidak punya tombol dan tidak pernah punya judul
               * terpisah lagi, jadi "teks di atas gambar" tidak punya
               * artinya di sana. Labelnya diperjelas supaya operator tidak
               * meng-toggle sesuatu yang tidak terjadi.
               */}
              <label className="acc-field">
                <span>Teks di atas gambar (carousel)</span>
                <label className="acc-checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.showTextOverlay}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        showTextOverlay: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    {draft.showTextOverlay
                      ? "Judul & tombol ditampilkan"
                      : "Banner bersih, gambar saja"}
                  </span>
                </label>
                <small>
                  Matikan kalau desain banner sudah memuat teks dan tombol
                  sendiri. Tidak memengaruhi popup: gambar popup selalu
                  tampil utuh, dan pesan + link selalu tampil apa adanya.
                </small>
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
            <div className="acc-receipts-head is-banner">
              <span>Banner</span>
              <span>CTA</span>
              <span>Tampil di</span>
              <span>Status</span>
              <span>Aksi</span>
            </div>
            {(payload?.banners ?? []).map((banner) => (
              <div className="acc-receipts-row is-banner" key={banner.id}>
                {/*
                  Thumbnail, bukan potongan URL.

                  Kolom ini sebelumnya menampilkan 64 karakter pertama
                  dari `imageUrl` kalau banner tidak punya subjudul. Itu
                  bukan informasi yang bisa dipakai: cloudinary URL-nya
                  panjang dan mirip antar banner, jadi operator tidak
                  bisa memverifikasi banner mana yang ini tanpa membuka
                  beranda. Karena tugas halaman ini justru memanggil
                  "banner aktif tampil di beranda", cara paling langsung
                  untuk memverifikasinya adalah melihat gambarnya.
                */}
                <div className="acc-banner-cell">
                  <img
                    className="acc-banner-thumb"
                    src={banner.imageUrl}
                    alt={banner.title}
                    loading="lazy"
                    width={120}
                    height={40}
                  />
                  <div>
                    <strong>{banner.title}</strong>
                    <span>
                      {banner.showTextOverlay === false && (
                        <em className="acc-chip-clean">Bersih</em>
                      )}
                      {banner.subtitle ?? "Tanpa subjudul"}
                    </span>
                    {/*
                     * Dimensi asli ditampilkan supaya operator bisa
                     * memastikan gambar yang diunggah memang yang dimaksud
                     * sebelum popup tayang ke pengguna.
                     *
                     * Banner lama (sebelum ada penyimpanannya) ditandai
                     * "ukuran belum tercatat" - jujur, bukan disembunyikan.
                     * Popup tetap menampilkannya dengan benar, hanya saja
                     * kotaknya baru tahu tinggi sebenarnya setelah gambar
                     * selesai dimuat.
                     */}
                    <span className="acc-banner-dims">
                      {banner.imageWidth && banner.imageHeight
                        ? `${banner.imageWidth} x ${banner.imageHeight} px`
                        : "ukuran belum tercatat"}
                    </span>
                  </div>
                </div>
                <span>{banner.promoCode ?? banner.ctaLabel ?? "-"}</span>
                <select
                  value={banner.displayMode}
                  disabled={!canManage || Boolean(busy)}
                  aria-label={`Lokasi tampil banner ${banner.title}`}
                  onChange={(event) => void changeDisplayMode(banner, event.target.value)}
                >
                  {Object.entries(DISPLAY_MODE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className={"acc-status " + (banner.active ? "active" : "inactive")}>
                  {banner.active ? "Aktif" : "Nonaktif"}
                </span>
                <div className="acc-action-panel">
                  <button
                    type="button"
                    disabled={!canManage || Boolean(busy)}
                    onClick={() => void toggleTextOverlay(banner)}
                    title="Alihkan antara tampil dengan teks di atas gambar dan banner bersih (gambar saja)"
                  >
                    {busy === "overlay:" + banner.id
                      ? "..."
                      : banner.showTextOverlay
                        ? "Jadikan bersih"
                        : "Pakai teks"}
                  </button>
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
                Belum ada banner — beranda menampilkan kartu promo/USP bawaan.
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
