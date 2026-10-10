import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";
import { readMerchantSessionFromValue } from "@/lib/merchant-session";
import { buildMerchantDashboard } from "@/lib/merchant-dashboard";
import { MerchantStatusBadge } from "@/components/merchant/MerchantStatusBadge";
import "@/app/merchant-portal.css";

/**
 * Riwayat transaksi + piutang untuk toko yang sudah masuk.
 *
 * Sesi diperiksa DI SERVER dan halaman memakai `force-dynamic`. Tanpa itu
 * React sempat merender kerangka halaman sebelum cookie dibaca, jadi piutang
 * bisa terlihat sesaat di perangkat yang dipakai bersama.
 *
 * Halaman yang butuh sesi selalu mengarahkan ke `/merchant` kalau belum
 * masuk - bukan menampilkan halaman kosong, karena layar kosong untuk yang
 * belum login akan disalahartikan sebagai "toko belum punya transaksi".
 */
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_merchant: "Menunggu scan",
  paid: "Sudah dibayar",
  processing: "Diproses",
  success: "Selesai",
  failed: "Gagal",
  refunded: "Dikembalikan",
  cancelled: "Dibatalkan",
  awaiting_receivable: "Selesai, menunggu bayar toko",
};

function formatIDR(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MerchantRiwayatPage() {
  if (!isMerchantRetailEnabled()) {
    redirect("/merchant");
  }

  const cookieStore = await cookies();
  const merchantId = readMerchantSessionFromValue(
    cookieStore.get("nambah_merchant_session")?.value,
  );

  if (!merchantId) {
    redirect("/merchant/login");
  }

  const merchant = await getMerchantById(merchantId);
  if (!merchant) {
    redirect("/merchant/login");
  }

  const dashboard = await buildMerchantDashboard(
    merchant.id,
    merchant.name,
    merchant.code,
    merchant.status,
    merchant.address,
  );

  return (
    <main className="merchant-portal-page">
      <div className="merchant-portal-card merchant-riwayat-card">
        <div className="merchant-portal-head">
          <div>
            <h1>{merchant.name}</h1>
            <p className="merchant-portal-code">{merchant.code}</p>
          </div>
          <Link className="merchant-portal-signout" href="/merchant">
            Kembali
          </Link>
        </div>

        <MerchantStatusBadge status={merchant.status} />

        {/*
         * Omzet memakai `earnings`, yang dihitung dari biaya layanan saja.
         * `finalPrice` bukan omzet toko: harga produk itu uang yang milik
         * Lacte untuk membayar supplier.
         */}
        <section className="merchant-stats">
          <div className="merchant-stat">
            <small>Hari ini</small>
            <strong>{formatIDR(dashboard.earnings.today)}</strong>
            <span>{dashboard.earnings.todayCount} transaksi</span>
          </div>
          <div className="merchant-stat">
            <small>7 hari</small>
            <strong>{formatIDR(dashboard.earnings.week)}</strong>
            <span>{dashboard.earnings.weekCount} transaksi</span>
          </div>
          <div className="merchant-stat">
            <small>30 hari</small>
            <strong>{formatIDR(dashboard.earnings.month)}</strong>
            <span>{dashboard.earnings.monthCount} transaksi</span>
          </div>
          <div className="merchant-stat">
            <small>Semua waktu</small>
            <strong>{formatIDR(dashboard.earnings.allTime)}</strong>
            <span>{dashboard.earnings.allTimeCount} transaksi</span>
          </div>
        </section>

        <section className="merchant-receivable">
          <h2>Piutang ke Lacte</h2>
          <dl>
            <div>
              <dt>Belum dibayar</dt>
              <dd>{formatIDR(dashboard.credit.outstanding)}</dd>
            </div>
            <div>
              <dt>Lewat tenggat</dt>
              <dd className={dashboard.credit.overdueCount > 0 ? "overdue" : ""}>
                {formatIDR(dashboard.credit.overdue)}
                {dashboard.credit.overdueCount > 0
                  ? ` (${dashboard.credit.overdueCount})`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Jatuh tempo &lt; 3 hari</dt>
              <dd>{formatIDR(dashboard.credit.dueSoon)}</dd>
            </div>
            <div>
              <dt>Menunggu scan</dt>
              <dd>{formatIDR(dashboard.credit.pendingScan)}</dd>
            </div>
            <div>
              <dt>Sisa kapasitas</dt>
              <dd>{formatIDR(dashboard.credit.remaining)}</dd>
            </div>
          </dl>
        </section>

        <section className="merchant-transactions">
          <h2>Transaksi terakhir</h2>
          {dashboard.transactions.length === 0 ? (
            <p className="merchant-portal-note">
              Belum ada transaksi. Transaksi muncul setelah kasir memindai
              pesanan pelanggan.
            </p>
          ) : (
            <table className="merchant-table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Status</th>
                  <th>Total dibayar</th>
                  <th>Biaya layanan</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.transactions.map((row) => (
                  <tr key={row.orderId}>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>
                      <span className="merchant-table-status">
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </td>
                    <td>{formatIDR(row.amount)}</td>
                    <td>{formatIDR(row.serviceFee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
