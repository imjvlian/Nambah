import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isMerchantRetailEnabled } from "@/lib/merchant-retail";
import { readMerchantSessionFromValue } from "@/lib/merchant-session";
import { MerchantLoginForm } from "@/components/merchant/MerchantLoginForm";
import "@/app/merchant-portal.css";

/**
 * `/merchant/login` — satu-satunya halaman login toko.
 *
 * Dipisah dari `/merchant` supaya yang kedua punya satu tugas saja: kalau
 * masuk, tampilkan menu; kalau belum, arahkan ke sini. Tanpa pemisahan itu
 * `/merchant` harus merender dua bentuk yang sama sekali berbeda, dan
 * `/merchant/login` jadi tidak punya URL sendiri untuk di-bookmark atau
 * dibagikan ke kasir.
 */
export const dynamic = "force-dynamic";

export default async function MerchantLoginPage() {
  const cookieStore = await cookies();
  const merchantId = readMerchantSessionFromValue(
    cookieStore.get("nambah_merchant_session")?.value,
  );

  // Sudah masuk? Jangan tampilkan form yang tidak akan dipakai.
  if (merchantId) {
    redirect("/merchant");
  }

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

  return (
    <main className="merchant-portal-page">
      <div className="merchant-portal-card">
        <h1>Masuk ke toko Anda</h1>
        <p className="merchant-portal-lead">
          Gunakan kode toko dan PIN kasir yang diberikan Lacte saat toko
          dibuat. Satu kali login sudah cukup untuk kasir, riwayat, dan
          dashboard.
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