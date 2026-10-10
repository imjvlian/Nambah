import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";
import { readMerchantSessionFromValue } from "@/lib/merchant-session";
import { MerchantKasir } from "@/components/merchant/MerchantKasir";
import "@/app/merchant-kasir.css";

/**
 * `/merchant/kasir` — layar pemindai.
 *
 * Halaman ini TIDAK punya form login sendiri. Dulu punya, dan itu yang
 * membuat kasir harus mengetik ulang kode + PIN setiap kali berpindah dari
 * `/merchant` ke sini — di aplikasi, perangkat, dan sesi yang sama.
 *
 * Sekarang `/merchant/login` satu-satunya tempat login, dan layar ini memakai
 * cookie sesi yang sama. Kalau belum masuk, pengarah ke sana.
 */
export const dynamic = "force-dynamic";

export default async function MerchantKasirPage() {
  const cookieStore = await cookies();
  const merchantId = readMerchantSessionFromValue(
    cookieStore.get("nambah_merchant_session")?.value,
  );

  if (!merchantId) {
    redirect("/merchant/login");
  }

  if (!isMerchantRetailEnabled()) {
    redirect("/merchant");
  }

  const merchant = await getMerchantById(merchantId);
  if (!merchant) {
    redirect("/merchant/login");
  }

  return (
    <MerchantKasir
      merchantCode={merchant.code}
      merchantName={merchant.name}
      merchantStatus={merchant.status}
    />
  );
}