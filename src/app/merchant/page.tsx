 import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";
import { readMerchantSessionFromValue } from "@/lib/merchant-session";
import { MerchantSignOutButton } from "@/components/merchant/MerchantSignOutButton";
import { MerchantStatusBadge } from "@/components/merchant/MerchantStatusBadge";
import "@/app/merchant-portal.css";

/**
 * `/merchant` — pusat toko setelah login.
 *
 * Tidak ada lagi form di sini. Kalau belum masuk, pengarah langsung ke
 * `/merchant/login`; kalau sudah, halaman ini hanya memilih tujuan. Satu
 * tugas per halaman, dan `/merchant/login` punya URL sendiri yang bisa
 * dikirim ke kasir.
 *
 * Sesi dibaca DI SERVER. Kalau pemeriksaannya di client, React sempat
 * merender isi halaman sebelum cookie dibaca - dan `/merchant` adalah tempat
 * nama toko serta statusnya tampil, jadi kebocoran sesaat di perangkat yang
 * dipakai bersama cukup untuk membuat orang mengira itu tokonya.
 */
export const dynamic = "force-dynamic";

export default async function MerchantHubPage() {
  const cookieStore = await cookies();
  const merchantId = readMerchantSessionFromValue(
    cookieStore.get("nambah_merchant_session")?.value,
  );

  if (!merchantId) {
    redirect("/merchant/login");
  }

  if (!isMerchantRetailEnabled()) {
    return (
      <main className="merchant-portal-page">
        <div className="merchant-portal-card">
          <h1>Program toko ritel belum dibuka</h1>
          <p className="merchant-portal-lead">Silakan cek lagi nanti.</p>
        </div>
      </main>
    );
  }

  const merchant = await getMerchantById(merchantId);
  if (!merchant) {
    redirect("/merchant/login");
  }

  return (
    <main className="merchant-portal-page">
      <div className="merchant-portal-card merchant-hub">
        <div className="merchant-portal-head">
          <div>
            <h1>{merchant.name}</h1>
            <p className="merchant-portal-code">{merchant.code}</p>
          </div>
          <MerchantSignOutButton />
        </div>

        <MerchantStatusBadge status={merchant.status} />

        <div className="merchant-cards">
          <Link className="merchant-card" href="/merchant/kasir">
            <span className="merchant-card-logo merchant-card-logo-kasir">
              <KasirIcon />
            </span>
            <span className="merchant-card-body">
              <strong>Kasir</strong>
              <small>Proses pesanan</small>
            </span>
          </Link>

          <Link className="merchant-card" href="/merchant/riwayat">
            <span className="merchant-card-logo merchant-card-logo-riwayat">
              <RiwayatIcon />
            </span>
            <span className="merchant-card-body">
              <strong>Riwayat</strong>
              <small>Omzet dan piutang</small>
            </span>
          </Link>
        </div>
      </div>
    </main>
  );
}

/*
 * Ikon digambar sebagai SVG sebaris, bukan font ikon atau pustaka.
 *
 * Alasannya ukuran: satu kotak SVG menambah beberapa ratus byte, sementara
 * paket font ikon menambah puluhan kilobyte ke setiap halaman yang memakainya.
 */

function KasirIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18v12H3z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3 10h18" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 15h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function RiwayatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 5h16v15H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 9h8M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}