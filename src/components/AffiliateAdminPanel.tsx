"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/lib/pricing";
import { useConfirm } from "@/components/AdminConfirmDialog";
import { affiliateLink } from "@/lib/affiliate-link";
import { BRAND } from "@/lib/brand";
import CopyButton from "@/components/CopyButton";

/**
 * Status affiliate, diterjemahkan.
 *
 * Nilai di database tetap bahasa Inggris - itu yang dibaca constraint di
 * migrasi 034 dan yang dipakai route `/r/[code]` untuk menolak kode
 * nonaktif. Yang diterjemahkan hanya yang ditampilkan.
 */
const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  suspended: "Ditangguhkan",
};

/**
 * Status pencairan, diterjemahkan.
 *
 * `reserved` dihitung dari request `pending` dan `approved`: keduanya
 * menahan komisi dari withdrawable, jadi nominalnya sudah tidak bisa
 * ditarik partner Though belum ditransfer.
 */
const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  paid: "Lunas",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
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
  affiliates: Array<{
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
  }>;
  error?: string;
};

type WithdrawalPayload = {
  withdrawals: Array<{
    id: number;
    affiliateCode: string;
    amount: number;
    method: string;
    accountName: string;
    accountNumber: string;
    status: string;
    requestedAt: string;
    processedAt: string | null;
    paidAt: string | null;
    rejectionReason: string | null;
    externalReference: string | null;
    processedByUserId: string | null;
  }>;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

type RegisteredUser = {
  userId: string;
  displayName: string | null;
  email: string | null;
  whatsapp: string | null;
};

function userLabel(user: RegisteredUser) {
  const primary = user.displayName ?? user.email ?? user.userId.slice(0, 8) + "…";
  return user.whatsapp ? `${primary} · ${user.whatsapp}` : primary;
}

export default function AffiliateAdminPanel() {
  const [affiliates, setAffiliates] = useState<AffiliatePayload | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalPayload["withdrawals"]>([]);
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [role, setRole] = useState("");
  const [linkDraft, setLinkDraft] = useState({ code: "", userId: "" });
  const [createDraft, setCreateDraft] = useState({
    displayName: "",
    code: "",
    commissionRate: "20",
    userBenefitType: "flat" as "flat" | "percentage",
    userBenefitValue: "0",
    minimumOrder: "0",
    userId: "",
    status: "active",
  });
  /*
   * Percakapan untuk satu aksi withdrawal.
   *
   * Sebelumnya alasan penolakan dan reference pembayaran diambil lewat
   * `window.prompt`. Dialog itu punya tiga masalah yang semuanya terasa
   * operator di saat tekanan:
   *
   *   - tidak ada konteks di samping kolomnya, jadi "Alasan penolakan:"
   *   disiarkan tanpa tahu request mana yang sedang dibahas;
   *   - `prompt` mengembalikan `null` saat ditutup, yang kode lamanya
   *   perlakukan sama dengan membatalkan - jadi tidak ada jalan untuk
   *   membatalkan dengan sengaja setelah mengetik;
   *   - teks yang sudah diketik hilang begitu dialog ditutup, jadi
   *   kesalahan ketik berarti mengetik ulang dari awal.
   *
   * Form di dalam halaman menghapus semua tiga itu, dan memberi
   * kesempatan membaca ulang sebelum mengirim - yang memang hal yang
   * paling penting untuk uang keluar.
   */
  const [dialog, setDialog] = useState<{
    id: number;
    action: "approve" | "reject" | "paid";
  } | null>(null);
  const [dialogText, setDialogText] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const confirm = useConfirm();
  const [notice, setNotice] = useState("");

  // Aksi payout (approve/paid withdrawal) tetap level tertinggi karena
  // menyentuh uang keluar; pengelolaan affiliate (buat/edit/hapus/link)
  // cukup admin ke atas.
  const canPayout = role === "superadmin" || role === "legacy";
  const canManage = canPayout || role === "admin";

  /*
   * Syarat boleh mengirim, mengikuti validasi server supaya operator
   * tidak gagal setelah menekan.
   *
   * Server memakai 3 karakter untuk keduanya; di sini 5 supaya alasan
   * penolakan yang cuma "ok" tidak sampai ke partner.
   */
  const dialogBlocked =
    dialog !== null && dialogText.trim().length < 5;

  const dialogTitle =
    dialog === null
      ? ""
      : dialog.action === "approve"
        ? "Setujui pencairan"
        : dialog.action === "paid"
          ? "Tandai sudah dibayar"
          : "Tolak pencairan";

  const dialogHint =
    dialog === null
      ? ""
      : dialog.action === "approve"
        ? "Menyetujui berarti dana readiness dialokasikan ke request ini. Transfer tetap dilakukan di luar sistem."
        : dialog.action === "paid"
          ? "Tandai setelah transfer benar-benar dikirim. Reference dipakai untuk rekonsiliasi."
          : "Alasan akan dibaca partner. Tulis yang bisa ditindaklanjuti.";

  async function load() {
    const [affiliateResponse, withdrawalResponse, sessionResponse, usersResponse] =
      await Promise.all([
        fetch("/api/admin/affiliates", { cache: "no-store" }),
        fetch("/api/admin/affiliates/withdrawals", { cache: "no-store" }),
        fetch("/api/admin/session", { cache: "no-store" }),
        fetch("/api/admin/users", { cache: "no-store" }),
      ]);

    if (
      affiliateResponse.status === 401 ||
      withdrawalResponse.status === 401 ||
      sessionResponse.status === 401
    ) {
      window.location.replace("/login?next=%2Fadmin%2Faffiliates");
      return;
    }

    const affiliateData = (await affiliateResponse.json()) as AffiliatePayload;
    const withdrawalData =
      (await withdrawalResponse.json()) as WithdrawalPayload;
    const sessionData = (await sessionResponse.json()) as {
      role?: string;
      error?: string;
    };
    const usersData = usersResponse.ok
      ? ((await usersResponse.json()) as { users?: RegisteredUser[] })
      : { users: [] };

    if (!affiliateResponse.ok) {
      throw new Error(affiliateData.error ?? "Affiliate gagal dimuat.");
    }
    if (!withdrawalResponse.ok) {
      throw new Error(withdrawalData.error ?? "Withdrawal gagal dimuat.");
    }

    setAffiliates(affiliateData);
    setWithdrawals(withdrawalData.withdrawals ?? []);
    setUsers(usersData.users ?? []);
    setRole(sessionData.role ?? "");
    if (!linkDraft.code && affiliateData.affiliates[0]) {
      setLinkDraft((current) => ({
        ...current,
        code: affiliateData.affiliates[0]!.code,
      }));
    }
  }

  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Affiliate gagal dimuat."),
    );
  }, []);

  const activeCount = useMemo(
    () =>
      withdrawals.filter(
        (item) => item.status === "pending" || item.status === "approved",
      ).length,
    [withdrawals],
  );

  // UUID -> display name user terdaftar, supaya kolom User tidak menampilkan
  // UUID mentah yang tidak terbaca.
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

  async function linkUser() {
    setBusy("link");
    setNotice("");
    try {
      const response = await fetch("/api/admin/affiliates/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(linkDraft),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Affiliate gagal dihubungkan.");
      }
      await load();
      setNotice("Affiliate user link diperbarui.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Affiliate gagal dihubungkan.",
      );
    } finally {
      setBusy("");
    }
  }

  async function createAffiliate() {
    setBusy("create");
    setNotice("");
    try {
      const rate = Number(createDraft.commissionRate) / 100;
      const response = await fetch("/api/admin/affiliates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: createDraft.displayName,
          code: createDraft.code || undefined,
          commissionRate: rate,
          userBenefitType: createDraft.userBenefitType,
          userBenefitValue: Number(createDraft.userBenefitValue),
          minimumOrder: Number(createDraft.minimumOrder),
          userId: createDraft.userId || undefined,
        }),
      });
      const body = (await response.json()) as {
        affiliate?: { code: string };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Affiliate gagal dibuat.");
      }
      setCreateDraft({
        displayName: "",
        code: "",
        commissionRate: "20",
        userBenefitType: "flat",
        userBenefitValue: "0",
        minimumOrder: "0",
        userId: "",
        status: "active",
      });
      await load();
      setNotice(`Affiliate ${body.affiliate?.code ?? ""} berhasil dibuat.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Affiliate gagal dibuat.",
      );
    } finally {
      setBusy("");
    }
  }

  function startEdit(item: AffiliatePayload["affiliates"][number]) {
    setEditingCode(item.code);
    setCreateDraft({
      displayName: item.displayName,
      code: item.code,
      commissionRate: String(Math.round(item.commissionRate * 100)),
      userBenefitType: item.userBenefitType,
      userBenefitValue: String(item.userBenefitValue),
      minimumOrder: String(item.minimumOrder),
      userId: item.userId ?? "",
      status: item.status,
    });
    setNotice(`Mode edit: ${item.code}. Kode tidak dapat diubah.`);
  }

  function cancelEdit() {
    setEditingCode(null);
    setCreateDraft({
      displayName: "",
      code: "",
      commissionRate: "20",
      userBenefitType: "flat",
      userBenefitValue: "0",
      minimumOrder: "0",
      userId: "",
      status: "active",
    });
    setNotice("");
  }

  async function saveEdit() {
    if (!editingCode) return;
    setBusy("create");
    setNotice("");
    try {
      const response = await fetch("/api/admin/affiliates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editingCode,
          displayName: createDraft.displayName,
          commissionRate: Number(createDraft.commissionRate) / 100,
          userBenefitType: createDraft.userBenefitType,
          userBenefitValue: Number(createDraft.userBenefitValue),
          minimumOrder: Number(createDraft.minimumOrder),
          status: createDraft.status,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Affiliate gagal diperbarui.");
      }
      const saved = editingCode;
      cancelEdit();
      await load();
      setNotice(`Affiliate ${saved} berhasil diperbarui.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Affiliate gagal diperbarui.",
      );
    } finally {
      setBusy("");
    }
  }

  async function deleteAffiliate(code: string) {
    const confirmed = await confirm({
      title: `Hapus affiliate ${code}?`,
      description:
        "Hanya bisa dilakukan bila kode belum punya riwayat komisi atau withdrawal.",
      tone: "danger",
      confirmLabel: "Hapus affiliate",
    });
    if (!confirmed) return;

    setBusy("delete:" + code);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/affiliates?code=${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Affiliate gagal dihapus.");
      }
      if (editingCode === code) cancelEdit();
      await load();
      setNotice(`Affiliate ${code} berhasil dihapus.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Affiliate gagal dihapus.",
      );
    } finally {
      setBusy("");
    }
  }

  async function transition(
    withdrawalId: number,
    action: "approve" | "reject" | "paid",
    text: string,
  ) {
    // Approve tidak butuh teks, tapi tetap mengirim string kosong supaya
    // bentuk payload sama untuk ketiga aksi.
    const reason = action === "reject" ? text.trim() : "";
    const externalReference = action === "paid" ? text.trim() : "";

    setBusy(action + ":" + withdrawalId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/affiliates/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          withdrawalId,
          action,
          reason,
          externalReference,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Pencairan gagal diperbarui.");
      }
      setDialog(null);
      setDialogText("");
      await load();
      setNotice(
        action === "approve"
          ? "Pencairan disetujui. Transfer dana ke partner."
          : action === "paid"
            ? "Pencairan ditandai lunas."
            : "Pencairan ditolak.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Pencairan gagal diperbarui.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="acc-page-sub">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            <small>Admin / Affiliate</small>
            <strong>Withdrawal Center</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin">← Control Center</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero">
            <div>
              <span className="acc-eyebrow">Pencairan afiliasi</span>
              <h1>Tinjau dulu, bayar di luar sistem.</h1>
              <p>
                {BRAND.shortName} mengunci alokasi komisi secara atomik. Transfer
                dana tetap dilakukan operator di luar sistem, lalu superadmin
                menandai request lunas dengan reference pembayaran.
              </p>
            </div>
          </section>

          {notice && <div className="acc-global-notice" role="status">{notice}</div>}

          <div className="acc-metrics">
            <article>
              <small>Available</small>
              <strong>{formatIDR(affiliates?.stats.available ?? 0)}</strong>
              <span>Belum di-reserve withdrawal</span>
            </article>
            <article>
              <small>Reserved</small>
              <strong>{formatIDR(affiliates?.stats.reserved ?? 0)}</strong>
              <span>{activeCount} request aktif</span>
            </article>
            <article>
              <small>Paid</small>
              <strong>{formatIDR(affiliates?.stats.withdrawn ?? 0)}</strong>
              <span>Withdrawal selesai</span>
            </article>
            <article>
              <small>Role</small>
              <strong>{role || "-"}</strong>
              <span>{canPayout ? "Payout action enabled" : "Read-only payout"}</span>
            </article>
          </div>

          <div className="acc-panel">
            <div className="acc-section-head">
              <div>
                <span className="acc-eyebrow">{editingCode ? "Edit partner" : "New partner"}</span>
                <h2>{editingCode ? `Edit affiliate ${editingCode}.` : "Buat affiliate code baru."}</h2>
                <p>
                  {editingCode
                    ? "Kode tidak dapat diubah. Simpan untuk menerapkan perubahan, atau batal untuk kembali."
                    : "Kode boleh dikosongkan untuk auto-generate dari display name. Assign ke user terdaftar bisa langsung atau belakangan."}
                </p>
              </div>
            </div>
            <div className="testlab-form-grid">
              <label className="acc-field">
                <span>Display name</span>
                <input
                  placeholder="Contoh: Creator Budi"
                  value={createDraft.displayName}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                />
                <small>Wajib. Nama yang tampil di laporan affiliate.</small>
              </label>

              <label className="acc-field">
                <span>Kode affiliate</span>
                <input
                  placeholder="Kosongkan untuk auto-generate"
                  value={createDraft.code}
                  disabled={Boolean(editingCode)}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      code: event.target.value.toUpperCase(),
                    }))
                  }
                />
                <small>
                  {editingCode
                    ? "Kode adalah primary key dan tidak dapat diubah."
                    : "Huruf besar/angka/-/_. Ini yang diketik customer saat checkout."}
                </small>
              </label>

              <label className="acc-field">
                <span>Komisi (%)</span>
                <input
                  placeholder="Default 20"
                  inputMode="decimal"
                  value={createDraft.commissionRate}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      commissionRate: event.target.value,
                    }))
                  }
                />
                <small>Persen dari profit yang jadi komisi partner.</small>
              </label>

              <label className="acc-field">
                <span>Tipe benefit pembeli</span>
                <select
                  value={createDraft.userBenefitType}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      userBenefitType: event.target.value as "flat" | "percentage",
                    }))
                  }
                >
                  <option value="flat">Flat (IDR)</option>
                  <option value="percentage">Percentage (%)</option>
                </select>
                <small>Bentuk diskon untuk customer yang memakai kode.</small>
              </label>

              <label className="acc-field">
                <span>Nilai benefit</span>
                <input
                  placeholder="Contoh: 500 (flat) atau 3 (%)"
                  inputMode="numeric"
                  value={createDraft.userBenefitValue}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      userBenefitValue: event.target.value,
                    }))
                  }
                />
                <small>Besar diskon sesuai tipe benefit di atas.</small>
              </label>

              <label className="acc-field">
                <span>Min. order benefit (IDR)</span>
                <input
                  placeholder="0 = tanpa minimum"
                  inputMode="numeric"
                  value={createDraft.minimumOrder}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      minimumOrder: event.target.value,
                    }))
                  }
                />
                <small>Order di bawah nilai ini tidak mendapat benefit.</small>
              </label>

              {editingCode ? (
                <label className="acc-field">
                  <span>Status</span>
                  <select
                    value={createDraft.status}
                    onChange={(event) =>
                      setCreateDraft((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                    <option value="suspended">Ditangguhkan</option>
                  </select>
                  <small>Suspended/inactive: kode tidak bisa dipakai customer.</small>
                </label>
              ) : (
                <label className="acc-field">
                  <span>Assign ke user</span>
                  <select
                    value={createDraft.userId}
                    onChange={(event) =>
                      setCreateDraft((current) => ({
                        ...current,
                        userId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Tanpa user (assign nanti)</option>
                    {users.map((user) => (
                      <option key={user.userId} value={user.userId}>
                        {userLabel(user)}
                      </option>
                    ))}
                  </select>
                  <small>Opsional. Hanya user yang sudah terdaftar.</small>
                </label>
              )}
            </div>

            <div className="acc-action-panel">
              <button
                type="button"
                disabled={busy === "create" || !canManage || !createDraft.displayName.trim()}
                onClick={() => void (editingCode ? saveEdit() : createAffiliate())}
              >
                {busy === "create"
                  ? "Saving..."
                  : editingCode
                    ? "Simpan perubahan"
                    : "Buat affiliate"}
              </button>
              {editingCode && (
                <button
                  type="button"
                  className="admin-secondary-button"
                  disabled={busy === "create"}
                  onClick={cancelEdit}
                >
                  Batal edit
                </button>
              )}
            </div>
          </div>

          <div className="acc-panel">
            <div className="acc-section-head">
              <div>
                <span className="acc-eyebrow">Ownership</span>
                <h2>Hubungkan affiliate ke akun {BRAND.shortName}.</h2>
                <p>
                  Pilih user terdaftar. Satu akun hanya dapat
                  memiliki satu affiliate link.
                </p>
              </div>
            </div>
            <div className="acc-action-panel">
              <select
                value={linkDraft.code}
                onChange={(event) =>
                  setLinkDraft((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
              >
                {(affiliates?.affiliates ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} · {item.displayName}
                  </option>
                ))}
              </select>
              <select
                value={linkDraft.userId}
                onChange={(event) =>
                  setLinkDraft((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
              >
                <option value="">— Tidak terhubung (unlink) —</option>
                {users.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {userLabel(user)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy === "link" || !canManage}
                onClick={() => void linkUser()}
              >
                {busy === "link" ? "Saving..." : "Save user link"}
              </button>
            </div>

            <div className="acc-table-card">
              <div className="acc-receipts-head">
                <span>Affiliate</span>
                <span>User</span>
                <span>Komisi</span>
                <span>Status</span>
                <span>Aksi</span>
              </div>
              {(affiliates?.affiliates ?? []).map((item) => {
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
                       * Link lengkapnya ditampilkan, tapi tombol salin hanya
                       * muncul kalau link itu benar-benar akan bekerja.
                       * `/r/[code]` menolak kode tanpa pemilik supaya komisi
                       * tidak masuk ke kode yang tidak ada yang mencairkan -
                       * jadi menyalin link itu untuk kode yang belum siap
                       * hanya menghasilkan trafik tanpa komisi.
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
                        onClick={() => void deleteAffiliate(item.code)}
                      >
                        {busy === "delete:" + item.code ? "Menghapus..." : "Hapus"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="acc-table-card">
            <div className="acc-receipts-head">
              <span>Request</span>
              <span>Tujuan</span>
              <span>Nominal</span>
              <span>Aksi</span>
            </div>
            {withdrawals.map((item) => (
              <div className="acc-receipts-row" key={item.id}>
                <div>
                  <strong>#{item.id} · {item.affiliateCode}</strong>
                  <span>
                    {WITHDRAWAL_STATUS_LABEL[item.status] ?? item.status} ·{" "}
                    {formatDate(item.requestedAt)}
                  </span>
                </div>
                <div>
                  <strong>{item.method}</strong>
                  <span>{item.accountName} · {item.accountNumber}</span>
                </div>
                <strong>{formatIDR(item.amount)}</strong>
                <div className="acc-action-panel">
                  {item.status === "pending" && (
                    <>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => {
                          setDialog({ id: item.id, action: "approve" });
                          setDialogText("");
                        }}
                      >
                        Setujui
                      </button>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => {
                          setDialog({ id: item.id, action: "reject" });
                          setDialogText("");
                        }}
                      >
                        Tolak
                      </button>
                    </>
                  )}
                  {item.status === "approved" && (
                    <>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => {
                          setDialog({ id: item.id, action: "paid" });
                          setDialogText("");
                        }}
                      >
                        Tandai lunas
                      </button>
                      <button
                        type="button"
                        disabled={!canPayout || Boolean(busy)}
                        onClick={() => {
                          setDialog({ id: item.id, action: "reject" });
                          setDialogText("");
                        }}
                      >
                        Tolak
                      </button>
                    </>
                  )}
                  {item.status === "paid" && (
                    <span>{item.externalReference ?? "Lunas"}</span>
                  )}
                  {item.status === "rejected" && (
                    <span>{item.rejectionReason ?? "Ditolak"}</span>
                  )}
                  {item.status === "cancelled" && (
                    <span>Dibatalkan partner</span>
                  )}
                </div>
              </div>
            ))}
            {withdrawals.length === 0 && (
              <div className="acc-empty">Belum ada permintaan pencairan.</div>
            )}
          </div>

          {dialog !== null && (
            <div className="acc-affiliate-dialog" role="dialog" aria-modal="true">
              <div className="acc-affiliate-dialog-card">
                <h3>{dialogTitle}</h3>
                <p>{dialogHint}</p>

                <label className="acc-field">
                  <span>
                    {dialog.action === "paid"
                      ? "Reference pembayaran"
                      : dialog.action === "reject"
                        ? "Alasan penolakan"
                        : "Catatan (opsional)"}
                  </span>
                  {dialog.action === "approve" ? (
                    <input
                      value={dialogText}
                      onChange={(event) => setDialogText(event.target.value)}
                      placeholder="Contoh: dicek saldo rekening partner"
                    />
                  ) : (
                    <input
                      value={dialogText}
                      onChange={(event) => setDialogText(event.target.value)}
                      placeholder={
                        dialog.action === "paid"
                          ? "Contoh: TRF/2026/11/00812"
                          : "Minimal 5 karakter"
                      }
                      autoFocus
                    />
                  )}
                </label>

                <div className="acc-affiliate-dialog-actions">
                  <button
                    type="button"
                    className="acc-primary-link"
                    disabled={dialogBlocked || Boolean(busy)}
                    onClick={() =>
                      void transition(dialog.id, dialog.action, dialogText)
                    }
                  >
                    {dialog.action === "approve"
                      ? "Setujui"
                      : dialog.action === "paid"
                        ? "Tandai lunas"
                        : "Kirim penolakan"}
                  </button>
                  <button
                    type="button"
                    className="admin-secondary-button"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setDialog(null);
                      setDialogText("");
                    }}
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
