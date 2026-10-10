import Link from "next/link";
import { cookies } from "next/headers";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";
import { readMerchantSessionFromCookieHeader } from "@/lib/merchant-session";
import { MerchantLoginForm } from "@/components/merchant/MerchantLoginForm";
import { MerchantSignOutButton } from "@/components/merchant/MerchantSignOutButton";
import "@/app/merchant-portal.css";

/**
 * `/merchant` — pintu masuk pemilik toko.
 *
 * Dua kondisi, ditentukan server-side dari cookie sesi:
 *
 * - SUDAH MASUK: dua pilihan, ke layar kasir atau ke riwayat transaksi.
 * - BELUM MASUK: form login, plus tautan pendaftaran.
 *
 * Kenapa tidak redirect ke login secara otomatis? Karena `/merchant` harus
 * bisa menjadi halaman utama toko: setelah masuk, halaman ini jadi tempat
 * pemilik toko kembali untuk berpindah antara kasir dan laporan.
 *
 * Pemeriksaan sesi dilakukan DI SERVER, bukan di client. Kalau deciding
 * di client, `/merchant` akan sempat merender isi menu sebelum cookie
 * dibaca - dan di perangkat yang dipakai bersama, itu cukup untuk
 * menampilkan piutang toko lain sesaat di layar.
 */

export const dynamic = "force-dynamic";

export default async function MerchantPortalPage() {
  if (!isMerchantRetailEnabled()) {
    return (
      <main className="merchant-portal-page">
        <div className="merchant-portal-card">
          <h1>Program toko ritel belum dibuka</h1>
          <p className="merchant-portal-lead">
            Halaman ini belum aktif. Silakan cek lagi nanti.
          </p>
        </div>
      </main>
    );
  }

  const cookieStore = await cookies();
  const merchantId = readMerchantSessionFromCookieHeader(
    cookieStore.get("nambah_merchant_session")?.value,
  );

  const merchant = merchantId ? await getMerchantById(merchantId) : null;

  if (!merchant) {
    return (
      <main className="merchant-portal-page">
        <div className="merchant-portal-card">
          <h1>Masuk ke toko Anda</h1>
          <p className="merchant-portal-lead">
            Gunakan kode toko dan PIN kasir yang diberikan Lacte saat toko
            dibuat.
          </p>

          <MerchantLoginForm />

          <p className="merchant-portal-note">
            Belum punya toko?{" "}
            <Link href="/merchant/register">Daftar di sini</Link>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="merchant-portal-page">
      <div className="merchant-portal-card">
        <div className="merchant-portal-head">
          <div>
            <h1>{merchant.name}</h1>
            <p className="merchant-portal-code">{merchant.code}</p>
          </div>
          <MerchantSignOutButton />
        </div>

        {merchant.status === "pending" ? (
          <p className="merchant-portal-banner">
            Toko Anda menunggu persetujuan admin. Anda sudah bisa masuk, tapi
            belum bisa menerima pesanan sampai disetujui.
          </p>
        ) : null}

        {merchant.status === "frozen" ? (
          <p className="merchant-portal-banner warn">
            Toko Anda sedang dibekukan karena ada piutang yang belum lunas.
            Lunasi dulu di halaman riwayat transaksi.
          </p>
        ) : null}

        <div className="merchant-portal-actions">
          <Link className="merchant-portal-action" href="/merchant/kasir">
            <strong>Ke Kasir</strong>
            <small>Periksa dan proses pesanan pelanggan</small>
          </Link>

          <Link className="merchant-portal-action" href="/merchant/riwayat">
            <strong>Riwayat Transaksi</strong>
            <small>Omzet, piutang, dan transaksi terakhir</small>
          </Link>
        </div>
      </div>
    </main>
  );
}