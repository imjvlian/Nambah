import { authorizeCronRequest } from "@/lib/cron-api";
import { checkAllSupplierBalances } from "@/lib/supplier-balance";

export const runtime = "nodejs";

/**
 * Cron cek saldo SEMUA supplier.
 *
 * Route lama `/api/cron/digiflazz-balance` sengaja dibiarkan apa adanya:
 * jadwal cron yang sudah terdaftar di dashboard Vercel tidak ikut berubah,
 * dan hasilnya tidak rusak. Route ini yang perlu dijadwalkan kalau alert
 * saldo Melostore juga mau masuk.
 *
 * Supplier yang kredensialnya belum diisi dilewati di dalam
 * `checkAllSupplierBalances` - satu akun yang belum diisi tidak boleh
 * menghentikan pemantauan supplier lain.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await checkAllSupplierBalances({
      source: "periodic",
      notify: true,
    });
    return Response.json(result);
  } catch (error) {
    console.error("Periodic supplier balance check failed", error);
    return Response.json({ error: "Periodic balance check gagal dijalankan." }, { status: 502 });
  }
}