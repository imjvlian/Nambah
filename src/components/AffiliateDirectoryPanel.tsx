"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { affiliateLink } from "@/lib/affiliate-link";
import CopyButton from "@/components/CopyButton";
import CollapsiblePanel from "@/components/admin/CollapsiblePanel";
import { useConfirm } from "@/components/AdminConfirmDialog";

/**
 * Direktori mitra afiliasi: buat, ubah, hubungkan, dan bagikan link.
 *
 * KENAPA PANEL INI ADA, DAN KENAPA DI SINI
 *
 * Sempat bagian dari halaman "Pencairan Afiliasi" (`/admin/affiliates`).
 * Nama halaman itu berarti satu hal: antrean pencairan. Tapi isinya
 * adalah manajemen mitra - membuat kode, menyetel komisi,
 * menghubungkan ke akun, dan membagikan link.
 *
 * Akibatnya ada dua tempat untuk satu pekerjaan. Seksi "Afiliasi" di
 * dashboard menampilkan Request dan Kinerja, tapi tidak bisa membuat
 * affiliate kecuali lewat link ke halaman pencairan; halaman pencairan
 * sendiri menampilkan form yang tidak ada hubungannya dengan pencairan.
 *
 * Pemisahan sekarang mengikuti pertanyaannya:
 *   - "Siapa mitra saya dan bagaimana kinerjanya" -> seksi Afiliasi.
 *   - "Uang mana yang harus saya cairkan" -> Pencairan Afiliasi.
 *
 * Data dimuat sendiri oleh panel ini, bukan lewat prop dari dashboard.
 * Dashboard sudah punya payload komisi sendiri untuk ledger, dan
 * menggabungkannya di sini berarti satu perubahan bentuk payload
 * affiliate bisa patah dua halaman sekaligus.
 */

type Affiliate = {
  code: string;
  displayName: string;
  userId: string | null;
  commissionRate: number;
  userBenefitType: "flat" | "percentage";
  userBenefitValue: number;
  minimumOrder: number;
  maxUserBenefit: number | null;
  stackableWithPromotions: boolean;
  status: string;
  createdAt: string;
  /** Kode upline (tier-2) — null = tanpa upline. */
  referredByCode: string | null;
};

type AffiliatePayload = {
  stats: {
    affiliates: number;
    active: number;
    pending: number;
    available: number;
    reserved: number;
    withdrawn: number;
    cancelled: number;
  };
  affiliates: Affiliate[];
  error?: string;
};

type RegisteredUser = {
  userId: string;
  displayName: string | null;
  email: string | null;
  whatsapp: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  suspended: "Ditangguhkan",
};

function blankDraft() {
  return {
    displayName: "",
    code: "",
    commissionRate: "20",
    userBenefitType: "flat" as "flat" | "percentage",
    userBenefitValue: "0",
    minimumOrder: "0",
    userId: "",
    referredByCode: "",
    status: "active",
  };
}

function userLabel(user: RegisteredUser) {
  const primary = user.displayName ?? user.email ?? user.userId.slice(0, 8) + "…";
  return user.whatsapp ? `${primary} · ${user.whatsapp}` : primary;
}

export default function AffiliateDirectoryPanel() {
  const [data, setData] = useState<AffiliatePayload | null>(null);
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [role, setRole] = useState("");
  const [draft, setDraft] = useState(blankDraft);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState({ code: "", userId: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const confirm = useConfirm();

  // Membuat atau mengubah mitra bukan tindakan uang keluar, jadi admin
  // sudah cukup. Aksi pencairan punya syaratnya sendiri di halamannya.
  const canManage = role === "superadmin" || role === "legacy" || role === "admin";

  const load = useCallback(async () => {
    const [affiliateResponse, sessionResponse, usersResponse] = await Promise.all([
      fetch("/api/admin/affiliates", { cache: "no-store" }),
      fetch("/api/admin/session", { cache: "no-store" }),
      fetch("/api/admin/users", { cache: "no-store" }),
    ]);

    if (affiliateResponse.status === 401 || sessionResponse.status === 401) {
      window.location.replace("/login?next=%2Fadmin%3Fseksi%3Daffiliates");
      return;
    }

    const affiliateData = (await affiliateResponse.json()) as AffiliatePayload;
    if (!affiliateResponse.ok) {
      throw new Error(affiliateData.error ?? "Mitra afiliasi gagal dimuat.");
    }

    const sessionData = (await sessionResponse.json()) as { role?: string };
    const usersData = usersResponse.ok
      ? ((await usersResponse.json()) as { users?: RegisteredUser[] })
      : { users: [] };

    setData(affiliateData);
    setRole(sessionData.role ?? "");
    setUsers(usersData.users ?? []);
    setError("");

    // Pilih kode pertama sebagai default, tapi jangan menimpa pilihan
    // yang sudah dibuat operator.
    setLinkDraft((current) =>
      current.code || !affiliateData.affiliates[0]
        ? current
        : { ...current, code: affiliateData.affiliates[0]!.code },
    );
  }, []);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Mitra afiliasi gagal dimuat."),
    );
  }, [load]);

  // UUID tidak bisa dibaca. Kolom User menampilkan nama kalau tersedia.
  const userNameById = useMemo(
    () =>
      new Map(
        users.map((user) => [
          user.userId,
          user.displayName ??
            user.email ??
            (user.whatsapp ? `WA ${user.whatsapp}` : user.userId.slice(0, 8) + "…"),
        ]),
      ),
    [users],
  );

  function startEdit(item: Affiliate) {
    setEditingCode(item.code);
    setDraft({
      displayName: item.displayName,
      code: item.code,
      commissionRate: String(Math.round(item.commissionRate * 100)),
      userBenefitType: item.userBenefitType,
      userBenefitValue: String(item.userBenefitValue),
      minimumOrder: String(item.minimumOrder),
      userId: item.userId ?? "",
      referredByCode: item.referredByCode ?? "",
      status: item.status,
    });
    setNotice("");
    setError("");
  }

  function cancelEdit() {
    setEditingCode(null);
    setDraft(blankDraft());
    setNotice("");
  }

  async function create() {
    setBusy("create");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/affiliates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draft.displayName,
          code: draft.code || undefined,
          commissionRate: Number(draft.commissionRate) / 100,
          userBenefitType: draft.userBenefitType,
          userBenefitValue: Number(draft.userBenefitValue),
          minimumOrder: Number(draft.minimumOrder),
          userId: draft.userId || undefined,
        }),
      });
      const body = (await response.json()) as { affiliate?: { code: string }; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Mitra gagal dibuat.");

      setDraft(blankDraft());
      setEditingCode(null);
      await load();
      setNotice(`Mitra ${body.affiliate?.code ?? ""} berhasil dibuat.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mitra gagal dibuat.");
    } finally {
      setBusy("");
    }
  }

  async function saveEdit() {
    if (!editingCode) return;
    setBusy("create");
    setNotice("");
    setError("");
    const saved = editingCode;
    try {
      const response = await fetch("/api/admin/affiliates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: saved,
          displayName: draft.displayName,
          commissionRate: Number(draft.commissionRate) / 100,
          userBenefitType: draft.userBenefitType,
          userBenefitValue: Number(draft.userBenefitValue),
          minimumOrder: Number(draft.minimumOrder),
          status: draft.status,
          referredByCode: draft.referredByCode || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Mitra gagal diperbarui.");

      cancelEdit();
      await load();
      setNotice(`Mitra ${saved} berhasil diperbarui.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mitra gagal diperbarui.");
    } finally {
      setBusy("");
    }
  }

  async function linkUser() {
    setBusy("link");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/affiliates/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(linkDraft),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Mitra gagal dihubungkan.");

      await load();
      setNotice("Koneksi mitra ke akun diperbarui.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mitra gagal dihubungkan.");
    } finally {
      setBusy("");
    }
  }

  async function remove(code: string) {
    const confirmed = await confirm({
      title: `Hapus mitra ${code}?`,
      description:
        "Hanya bisa dilakukan bila kode belum punya riwayat komisi atau pencairan.",
      tone: "danger",
      confirmLabel: "Hapus mitra",
    });
    if (!confirmed) return;

    setBusy("delete:" + code);
    setNotice("");
    setError("");
    try {
      const response = await fetch(
        `/api/admin/affiliates?code=${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Mitra gagal dihapus.");

      if (editingCode === code) cancelEdit();
      await load();
      setNotice(`Mitra ${code} berhasil dihapus.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mitra gagal dihapus.");
    } finally {
      setBusy("");
    }
  }

  const affiliates = data?.affiliates ?? [];

  return (
    <div className="acc-affiliate-directory">
      {notice ? (
        <p className="acc-global-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="acc-global-notice error" role="alert">
          {error}
        </p>
      ) : null}

      {/*
       * Form dibuat/ubah disembunyikan sampai dibuka.
       *
       * Sembilan field yang selalu terbuka membuat operator harus
       * melewati form lengkap sebelum bisa sampai ke tabel mitra - dan
       * tabel itu yang biasanya dicari. Panel ini terbuka otomatis
       * kalau sedang mengedit, jadi tombol "Ubah" di tabel tidak
       * terasa seperti tidak terjadi apa-apa.
       */}
      <CollapsiblePanel
        title={editingCode ? `Ubah mitra ${editingCode}` : "Buat mitra afiliasi"}
        description={
          editingCode
            ? "Kode adalah kunci utama dan tidak bisa diubah setelah dibuat."
            : "Kode boleh dikosongkan untuk dibuat otomatis dari nama."
        }
        defaultOpen={Boolean(editingCode)}
      >
        <div className="testlab-form-grid">
          <label className="acc-field">
            <span>Nama mitra</span>
            <input
              placeholder="Contoh: Creator Budi"
              value={draft.displayName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, displayName: event.target.value }))
              }
            />
            <small>Wajib. Nama ini yang tampil di laporan.</small>
          </label>

          <label className="acc-field">
            <span>Kode afiliasi</span>
            <input
              placeholder="Kosongkan untuk dibuat otomatis"
              value={draft.code}
              disabled={Boolean(editingCode)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  code: event.target.value.toUpperCase(),
                }))
              }
            />
            <small>
              {editingCode
                ? "Kode adalah kunci utama dan tidak bisa diubah."
                : "Huruf besar, angka, - atau _. Diketik pembeli saat checkout."}
            </small>
          </label>

          <label className="acc-field">
            <span>Komisi (%)</span>
            <input
              placeholder="20"
              inputMode="decimal"
              value={draft.commissionRate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, commissionRate: event.target.value }))
              }
            />
            <small>Persen dari laba yang menjadi komisi mitra.</small>
          </label>

          <label className="acc-field">
            <span>Jenis potongan pembeli</span>
            <select
              value={draft.userBenefitType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  userBenefitType: event.target.value as "flat" | "percentage",
                }))
              }
            >
              <option value="flat">Potongan tetap (Rp)</option>
              <option value="percentage">Potongan persen (%)</option>
            </select>
            <small>Diskon untuk pembeli yang memakai kode ini.</small>
          </label>

          <label className="acc-field">
            <span>Besar potongan</span>
            <input
              placeholder="Contoh: 500 atau 3"
              inputMode="numeric"
              value={draft.userBenefitValue}
              onChange={(event) =>
                setDraft((current) => ({ ...current, userBenefitValue: event.target.value }))
              }
            />
            <small>Sesuai jenis potongan di atas.</small>
          </label>

          <label className="acc-field">
            <span>Minimum belanja (Rp)</span>
            <input
              placeholder="0 = tanpa minimum"
              inputMode="numeric"
              value={draft.minimumOrder}
              onChange={(event) =>
                setDraft((current) => ({ ...current, minimumOrder: event.target.value }))
              }
            />
            <small>Belanja di bawah nilai ini tidak dapat potongan.</small>
          </label>

          {editingCode ? (
            <>
              <label className="acc-field">
                <span>Status</span>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                  <option value="suspended">Ditangguhkan</option>
                </select>
                <small>
                  Nonaktif dan ditangguhkan membuat kode ditolak saat dibuka pembeli.
                </small>
              </label>

              {/*
               * Upline / tier-2 (P2): komisi 10% dari laba order yang
               * masuk lewat kode mitra ini mengalir ke upline. First-touch
               * cookie menangkap upline otomatis saat pendaftar simpan
               * profil; kolom ini untuk rekrutan langsung dan koreksi.
               */}
              <label className="acc-field">
                <span>Upline (komisi tier-2)</span>
                <select
                  value={draft.referredByCode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      referredByCode: event.target.value,
                    }))
                  }
                >
                  <option value="">Tanpa upline</option>
                  {affiliates
                    .filter(
                      (item) =>
                        item.code !== editingCode &&
                        item.userId &&
                        item.status === "active",
                    )
                    .map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.code} · {item.displayName}
                      </option>
                    ))}
                </select>
                <small>
                  Upline menerima 10% dari laba order lewat kode mitra ini —
                  dipotong dari bagian toko, bukan dari komisi mitra.
                </small>
              </label>
            </>
          ) : (
            <label className="acc-field">
              <span>Hubungkan ke akun</span>
              <select
                value={draft.userId}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, userId: event.target.value }))
                }
              >
                <option value="">Belum ada (hubungkan nanti)</option>
                {users.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {userLabel(user)}
                  </option>
                ))}
              </select>
              <small>
                Tanpa pemilik, link tidak bisa dipakai dan komisi tidak bisa dicairkan.
              </small>
            </label>
          )}
        </div>

        <div className="acc-action-panel">
          <button
            type="button"
            disabled={busy === "create" || !canManage || !draft.displayName.trim()}
            onClick={() => void (editingCode ? saveEdit() : create())}
          >
            {busy === "create"
              ? "Menyimpan..."
              : editingCode
                ? "Simpan perubahan"
                : "Buat mitra"}
          </button>
          {editingCode && (
            <button
              type="button"
              className="admin-secondary-button"
              disabled={busy === "create"}
              onClick={cancelEdit}
            >
              Batal
            </button>
          )}
        </div>
      </CollapsiblePanel>

      <div className="acc-panel">
        <div className="acc-section-head">
          <div>
            <span className="acc-eyebrow">Koneksi akun</span>
            <h2>Hubungkan mitra ke akun pembeli.</h2>
            <p>
              Satu akun hanya boleh punya satu kode afiliasi. Mitra tanpa
              pemilik tetap bisa dibuat, tapi link-nya belum bisa dibagikan.
            </p>
          </div>
        </div>

        <div className="acc-action-panel">
          <select
            aria-label="Kode afiliasi"
            value={linkDraft.code}
            onChange={(event) =>
              setLinkDraft((current) => ({ ...current, code: event.target.value }))
            }
          >
            {affiliates.length === 0 ? <option value="">Belum ada mitra</option> : null}
            {affiliates.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.displayName}
              </option>
            ))}
          </select>
          <select
            aria-label="Akun pembeli"
            value={linkDraft.userId}
            onChange={(event) =>
              setLinkDraft((current) => ({ ...current, userId: event.target.value }))
            }
          >
            <option value="">Tidak terhubung</option>
            {users.map((user) => (
              <option key={user.userId} value={user.userId}>
                {userLabel(user)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy === "link" || !canManage || !linkDraft.code}
            onClick={() => void linkUser()}
          >
            {busy === "link" ? "Menyimpan..." : "Simpan koneksi"}
          </button>
        </div>

        <div className="acc-table-card">
          <div className="acc-receipts-head">
            <span>Mitra</span>
            <span>Akun</span>
            <span>Komisi</span>
            <span>Status</span>
            <span>Aksi</span>
          </div>

          {affiliates.length === 0 ? (
            <div className="acc-empty">Belum ada mitra afiliasi.</div>
          ) : null}

          {affiliates.map((item) => {
            const link = affiliateLink({
              code: item.code,
              status: item.status,
              hasOwner: Boolean(item.userId),
            });

            return (
              <div className="acc-receipts-row" key={item.code}>
                <div>
                  <strong>{item.code}</strong>
                  <span>{item.displayName}</span>
                  {/*
                   * Linknya ditampilkan, tapi tombol salin hanya muncul
                   * kalau link itu benar-benar akan bekerja. `/r/[code]`
                   * menolak kode tanpa pemilik supaya komisi tidak masuk
                   * ke kode yang tidak ada yang mencairkan - menyalin
                   * link seperti itu hanya menghasilkan trafik tanpa
                   * komisi, dan itu baru ketahuan setelah ratusan klik.
                   */}
                  <span className="acc-affiliate-share">
                    <code title={link.url}>{link.url}</code>
                    {link.usable ? (
                      <CopyButton value={link.url} />
                    ) : (
                      <em>{link.warning}</em>
                    )}
                  </span>
                </div>
                <span>
                  {item.userId
                    ? (userNameById.get(item.userId) ?? item.userId)
                    : "Belum terhubung"}
                  {item.referredByCode ? (
                    <>
                      {" · "}
                      <em>upline: {item.referredByCode}</em>
                    </>
                  ) : null}
                </span>
                <strong>{Math.round(item.commissionRate * 100)}%</strong>
                <span className={"acc-status " + item.status}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
                <div className="acc-action-panel">
                  <button
                    type="button"
                    disabled={!canManage || Boolean(busy)}
                    onClick={() => startEdit(item)}
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    disabled={!canManage || Boolean(busy)}
                    onClick={() => void remove(item.code)}
                  >
                    {busy === "delete:" + item.code ? "Menghapus..." : "Hapus"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}