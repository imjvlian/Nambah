"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatIDR } from "@/lib/pricing";
import {
  elapsedSince,
  isOpenOrder,
  statusHint,
  statusLabel,
  statusTone,
} from "@/lib/order-status-display";
import AffiliateAccountPanel from "@/components/AffiliateAccountPanel";
import AffiliateJoinPanel from "@/components/AffiliateJoinPanel";

type AccountUser = {
  id: string;
  email: string;
  displayName: string;
  emailConfirmed: boolean;
  createdAt: string | null;
};

type AccountOrder = {
  id: string;
  status: string;
  finalPrice: number;
  pointsRedeemed: number;
  pointsDiscount: number;
  pointsEarned: number;
  createdAt: string;
  updatedAt: string;
  gameName: string;
  packageLabel: string;
};

type PointsSummary = {
  balance: number;
  reserved: number;
  available: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  rules: {
    pointValueIdr: number;
    earnEveryIdr: number;
    minimumRedeem: number;
    redeemStep: number;
    maxRedeemRate: number;
  };
};

type CustomerProfile = {
  displayName: string;
  whatsapp: string;
  preferredReceiptChannel: "email" | "whatsapp" | "both";
  updatedAt: string | null;
};

type PointLedger = {
  id: number;
  orderId: string | null;
  type: string;
  pointsDelta: number;
  reservedDelta: number;
  balanceAfter: number;
  reservedAfter: number;
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
};

/**
 * Tab dashboard.
 *
 * Sebelum ini semua konten ditumpuk vertikal dalam satu halaman: profil,
 * points (dengan 30 baris aktivitas), afiliasi, lalu riwayat pesanan. Bagian
 * yang paling sering dicek user — status order — justru paling bawah.
 *
 * Tab memakai `useState`, bukan routing: URL tetap `/account`, tidak ada
 * request tambahan, dan tombol back browser tetap bekerja seperti sekarang.
 */
type AccountTab = "orders" | "points" | "profile" | "affiliate";

const TABS: ReadonlyArray<{ id: AccountTab; label: string; hint: string }> = [
  { id: "orders", label: "Transaksi", hint: "Riwayat pesanan kamu" },
  { id: "points", label: "Nambah Points", hint: "Saldo dan aktivitas points" },
  { id: "affiliate", label: "Afiliasi", hint: "Komisi dan pendaftaran" },
  { id: "profile", label: "Profil", hint: "Data untuk checkout" },
];

/**
 * Istilah points dalam bahasa sehari-hari.
 *
 * "Reserved", "Lifetime earned", dan "Lifetime redeemed" adalah istilah akuntansi
 * internal, bukan bahasa yang dipakai user. Angka dan mekanismenya tidak berubah —
 * hanya yang ditampilkan.
 */
const POINTS_TERM_LABEL: Record<string, string> = {
  reserved: "Sedang dipakai",
  available: "Bisa dipakai",
  lifetimeEarned: "Total pernah didapat",
  lifetimeRedeemed: "Total pernah dipakai",
};

const POINT_TYPE_LABEL: Record<string, string> = {
  reserve: "Points ditahan",
  redeem: "Points digunakan",
  release: "Points dilepas",
  earn: "Points didapat",
  refund: "Points dikembalikan",
  reversal: "Points dibatalkan",
  expire: "Points kedaluwarsa",
  admin_adjustment: "Penyesuaian",
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

function signedPoints(value: number) {
  if (value > 0) return "+" + value.toLocaleString("id-ID");
  return value.toLocaleString("id-ID");
}

/**
 * Satu baris pesanan.
 *
 * Dipisah dari komponen utama karena dipakai dua kali: order yang sedang
 * berjalan dan riwayat yang sudah selesai.
 *
 * Dua tambahan dari versi lama:
 *
 * - Waktu relatif untuk order yang belum selesai. "Sedang diproses" tanpa
 *   waktu tidak bisa dinilai user: 3 menit itu wajar, 3 jam itu tidak.
 * - Penjelasan singkat di bawah status, dari `statusHint`.
 */
function AccountOrderRow({ order }: { order: AccountOrder }) {
  const open = isOpenOrder(order.status);
  const elapsed = open ? elapsedSince(order.updatedAt) : null;

  return (
    <Link
      className={"account-order-row tone-" + statusTone(order.status)}
      href={"/order/" + encodeURIComponent(order.id)}
    >
      <div className="account-order-product">
        <small>{order.id}</small>
        <strong>{order.gameName}</strong>
        <span>{order.packageLabel}</span>
        {(order.pointsEarned > 0 || order.pointsRedeemed > 0) && (
          <span className="account-order-points">
            {order.pointsRedeemed > 0
              ? "-" +
                order.pointsRedeemed.toLocaleString("id-ID") +
                " pts dipakai"
              : ""}
            {order.pointsRedeemed > 0 && order.pointsEarned > 0 ? " · " : ""}
            {order.pointsEarned > 0
              ? "+" + order.pointsEarned.toLocaleString("id-ID") + " pts"
              : ""}
          </span>
        )}
      </div>

      <div className="account-order-time">
        <small>{open ? "Berjalan sejak" : "Dibuat"}</small>
        <span>{formatDate(open ? order.updatedAt : order.createdAt)}</span>
        {elapsed && (
          <em className="account-order-elapsed">{elapsed}</em>
        )}
      </div>

      <div className="account-order-price">
        <small>Total</small>
        <strong>{formatIDR(order.finalPrice)}</strong>
      </div>

      <span className={"account-order-status tone-" + statusTone(order.status)}>
        <b>{statusLabel(order.status)}</b>
        {open && statusHint(order.status) && (
          <small className="account-order-hint">{statusHint(order.status)}</small>
        )}
      </span>
    </Link>
  );
}

export default function AccountDashboard() {  const [user, setUser] = useState<AccountUser | null>(null);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [points, setPoints] = useState<PointsSummary | null>(null);
  const [ledger, setLedger] = useState<PointLedger[]>([]);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    displayName: "",
    whatsapp: "",
    preferredReceiptChannel: "email" as "email" | "whatsapp" | "both",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [pointsError, setPointsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [tab, setTab] = useState<AccountTab>("orders");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const meResponse = await fetch("/api/auth/me", {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (meResponse.status === 401) {
          window.location.replace("/login?next=%2Faccount");
          return;
        }

        const meData = (await meResponse.json()) as {
          user?: AccountUser;
          error?: string;
        };
        if (!meResponse.ok || !meData.user) {
          throw new Error(meData.error ?? "Akun belum dapat dimuat.");
        }

        if (!active) return;
        setUser(meData.user);

        const [ordersResponse, pointsResponse, profileResponse] =
          await Promise.all([
            fetch("/api/account/orders", {
              cache: "no-store",
              credentials: "same-origin",
            }),
            fetch("/api/account/points", {
              cache: "no-store",
              credentials: "same-origin",
            }),
            fetch("/api/account/profile", {
              cache: "no-store",
              credentials: "same-origin",
            }),
          ]);

        const ordersData = (await ordersResponse.json()) as {
          orders?: AccountOrder[];
          error?: string;
        };
        if (!ordersResponse.ok) {
          throw new Error(
            ordersData.error ?? "Riwayat transaksi belum dapat dimuat.",
          );
        }

        const pointsData = (await pointsResponse.json()) as {
          points?: PointsSummary;
          ledger?: PointLedger[];
          error?: string;
        };
        const profileData = (await profileResponse.json()) as {
          profile?: CustomerProfile;
          error?: string;
        };

        if (!active) return;
        setOrders(ordersData.orders ?? []);

        if (profileResponse.ok && profileData.profile) {
          setProfile(profileData.profile);
          setProfileDraft({
            displayName: profileData.profile.displayName,
            whatsapp: profileData.profile.whatsapp,
            preferredReceiptChannel:
              profileData.profile.preferredReceiptChannel,
          });
        }

        if (pointsResponse.ok && pointsData.points) {
          setPoints(pointsData.points);
          setLedger(pointsData.ledger ?? []);
          setPointsError("");
        } else {
          setPointsError(
            pointsData.error ?? "Nambah Points belum dapat dimuat.",
          );
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Halaman akun belum dapat dimuat.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function saveProfile() {
    setProfileSaving(true);
    setProfileMessage("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(profileDraft),
      });
      const data = (await response.json()) as {
        profile?: CustomerProfile;
        error?: string;
      };
      if (!response.ok || !data.profile) {
        throw new Error(data.error ?? "Profil gagal disimpan.");
      }
      setProfile(data.profile);
      setProfileDraft({
        displayName: data.profile.displayName,
        whatsapp: data.profile.whatsapp,
        preferredReceiptChannel: data.profile.preferredReceiptChannel,
      });
      setProfileMessage("Profil tersimpan.");
    } catch (error) {
      setProfileMessage(
        error instanceof Error ? error.message : "Profil gagal disimpan.",
      );
    } finally {
      setProfileSaving(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      window.location.replace("/");
    }
  }

  if (loading) {
    return <div className="account-loading-card">Memuat akun Nambah...</div>;
  }

  if (error) {
    return (
      <div className="account-loading-card">
        <strong>Akun belum dapat dimuat.</strong>
        <p>{error}</p>
        <Link className="text-link" href="/">Kembali ke beranda</Link>
      </div>
    );
  }

  if (!user) return null;

  // Order yang belum selesai dipisah dari riwayat yang sudah selesai.
  // User membuka dashboard ini paling sering karena order-nya jalan atau
  // belum — bukan untuk membrowse arsip.
  const openOrders = orders.filter((order) => isOpenOrder(order.status));
  const closedOrders = orders.filter((order) => !isOpenOrder(order.status));
  const openCount = openOrders.length;

  return (
    <>
      <section className="account-profile-card">
        <div className="account-avatar">
          {user.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="account-profile-copy">
          <span className="eyebrow">Akun Nambah</span>
          <h1>{user.displayName}</h1>
          <p>{user.email}</p>
          <div className="account-profile-meta">
            <span>
              {user.emailConfirmed
                ? "Email terverifikasi"
                : "Email belum terverifikasi"}
            </span>
            {user.createdAt && (
              <span>Bergabung {formatDate(user.createdAt)}</span>
            )}
          </div>
        </div>
        <button
          className="account-logout"
          type="button"
          disabled={loggingOut}
          onClick={() => void logout()}
        >
          {loggingOut ? "Keluar..." : "Keluar"}
        </button>
      </section>

      <nav className="account-tabs" aria-label="Bagian akun">
        {TABS.map((item) => {
          const count = item.id === "orders" ? openCount : 0;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              <b>{item.label}</b>
              <small>{item.hint}</small>
              {count > 0 && (
                <span className="account-tab-badge">{count} berjalan</span>
              )}
            </button>
          );
        })}
      </nav>

      {tab === "profile" && (
        <section className="account-profile-settings">
        <div className="account-section-head">
          <div>
            <span className="eyebrow">Profil</span>
            <h2>Data checkout.</h2>
          </div>
          <span className="account-profile-saved">
            {profile?.updatedAt ? "Tersimpan " + formatDate(profile.updatedAt) : "Belum disimpan"}
          </span>
        </div>
        <div className="account-profile-form">
          <label>
            <span>Nama</span>
            <input
              value={profileDraft.displayName}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              placeholder="Nama kamu"
            />
          </label>
          <label>
            <span>WhatsApp</span>
            <input
              inputMode="tel"
              value={profileDraft.whatsapp}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  whatsapp: event.target.value,
                }))
              }
              placeholder="081234567890"
            />
          </label>
          <label>
            <span>Preferensi receipt</span>
            <select
              value={profileDraft.preferredReceiptChannel}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  preferredReceiptChannel: event.target.value as
                    | "email"
                    | "whatsapp"
                    | "both",
                }))
              }
            >
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="both">Email + WhatsApp</option>
            </select>
          </label>
          <button
            type="button"
            disabled={profileSaving}
            onClick={() => void saveProfile()}
          >
            {profileSaving ? "Menyimpan..." : "Simpan profil"}
          </button>
        </div>
        {profileMessage && (
          <p className="account-profile-message">{profileMessage}</p>
        )}
        </section>
      )}

      {tab === "points" && (
      <section className="account-points-card" id="nambah-points">
        <div className="account-points-hero">
          <div>
            <span className="eyebrow">Nambah Points</span>
            <h2>
              {points ? points.available.toLocaleString("id-ID") : "—"}{" "}
              <small>pts</small>
            </h2>
            <p>
              {points
                ? "Setara sekitar " +
                  formatIDR(
                    points.available * points.rules.pointValueIdr,
                  ) +
                  " untuk transaksi berikutnya."
                : pointsError || "Saldo points sedang dimuat."}
            </p>
          </div>
          {points && (
            <div className="account-points-stats">
              <article title="Points yang sedang dipakai untuk order yang belum selesai.">
                <small>{POINTS_TERM_LABEL.reserved}</small>
                <strong>{points.reserved.toLocaleString("id-ID")} pts</strong>
              </article>
              <article title="Semua points yang pernah didapat sejak akun dibuat.">
                <small>{POINTS_TERM_LABEL.lifetimeEarned}</small>
                <strong>
                  {points.lifetimeEarned.toLocaleString("id-ID")} pts
                </strong>
              </article>
              <article title="Semua points yang pernah dipakai untuk transaksi.">
                <small>{POINTS_TERM_LABEL.lifetimeRedeemed}</small>
                <strong>
                  {points.lifetimeRedeemed.toLocaleString("id-ID")} pts
                </strong>
              </article>
            </div>
          )}
        </div>

        {points && (
          <div className="account-points-rule">
            <span>Setiap {formatIDR(points.rules.earnEveryIdr)} belanja dapat 1 point</span>
            <span>1 point setara {formatIDR(points.rules.pointValueIdr)}</span>
            <span>Minimal pakai {points.rules.minimumRedeem} points</span>
            <span>
              Maksimal {Math.round(points.rules.maxRedeemRate * 100)}% dari total belanja
            </span>
          </div>
        )}

        <div className="account-points-ledger">
          <div className="account-points-ledger-head">
            <strong>Aktivitas points</strong>
            <span>30 aktivitas terbaru</span>
          </div>
          {ledger.length === 0 ? (
            <div className="account-points-empty">
              Belum ada aktivitas points. Points masuk setelah transaksi login
              berstatus berhasil.
            </div>
          ) : (
            ledger.map((entry) => (
              <div className="account-point-row" key={entry.id}>
                <span
                  className={"account-point-icon type-" + entry.type}
                >
                  N+
                </span>
                <div>
                  <strong>
                    {POINT_TYPE_LABEL[entry.type] ?? entry.type}
                  </strong>
                  <small>
                    {entry.orderId ?? "Akun"} · {formatDate(entry.createdAt)}
                  </small>
                </div>
                <b
                  className={
                    entry.pointsDelta > 0
                      ? "positive"
                      : entry.pointsDelta < 0
                        ? "negative"
                        : ""
                  }
                >
                  {entry.pointsDelta === 0
                    ? entry.reservedDelta > 0
                      ? "ditahan " +
                        entry.reservedDelta.toLocaleString("id-ID")
                      : entry.reservedDelta < 0
                        ? "dilepas " +
                          Math.abs(entry.reservedDelta).toLocaleString("id-ID")
                        : "0"
                    : signedPoints(entry.pointsDelta)}{" "}
                  pts
                </b>
              </div>
            ))
          )}
        </div>
      </section>
      )}

      {tab === "affiliate" && (
        <>
          <AffiliateAccountPanel />
          <AffiliateJoinPanel />
        </>
      )}

      {tab === "orders" && (
      <section className="account-orders-card">
        <div className="account-section-head">
          <div>
            <span className="eyebrow">Transaksi</span>
            <h2>Riwayat pesanan.</h2>
          </div>
          <Link className="header-cta" href="/#catalog-start">
            Top up lagi
          </Link>
        </div>

        {openCount > 0 && (
          <div className="account-orders-open">
            <strong className="account-orders-open-title">
              {openCount} pesanan sedang berjalan
            </strong>
            <p>
              Yang masih diproses atau menunggu pembayaran. Klik untuk melihat
              detail danSN.
            </p>
            <div className="account-order-list">
              {openOrders.map((order) => (
                <AccountOrderRow key={order.id} order={order} />
              ))}
            </div>
          </div>
        )}

        {closedOrders.length > 0 && (
          <details
            className="account-orders-closed"
            open={openCount === 0}
          >
            <summary>
              {openCount > 0 ? "Tampilkan" : ""} riwayat selesai ({closedOrders.length})
            </summary>
            <div className="account-order-list">
              {closedOrders.map((order) => (
                <AccountOrderRow key={order.id} order={order} />
              ))}
            </div>
          </details>
        )}

        {orders.length === 0 ? (
          <div className="account-empty">
            <strong>Belum ada transaksi di akun ini.</strong>
            <p>
              Pesanan baru yang dibuat saat kamu login akan muncul otomatis di
              sini.
            </p>
            <Link className="primary-button" href="/#catalog-start">
              Mulai top up <span>→</span>
            </Link>
          </div>
        ) : null}
      </section>
      )}
    </>
  );
}
