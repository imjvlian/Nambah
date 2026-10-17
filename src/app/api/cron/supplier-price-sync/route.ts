import { authorizeCronRequest } from "@/lib/cron-api";
import { syncSupplierPrices } from "@/lib/supplier-price-sync";

export const runtime = "nodejs";

/**
 * Cron sinkron harga modal supplier (Digiflazz + Melostore).
 *
 * Hanya memperbarui supplier_products.supplier_cost dengan pagar delta
 * >±10% (ditahan + dilaporkan), lalu mengirim ringkasan Telegram kalau
 * ada perubahan. Harga jual TIDAK disentuh - itu jalur admin.
 *
 * Harga jual tidak perlu ikut: checkout memvalidasi margin saat order
 * dibuat (minimumNambahProfit), dan dispatch memblokir kalau harga hidup
 * naik melewati harga beku - jadi harga jual basi tidak pernah menjual
 * rugi; yang basi cukup membuat order GAGAL dispatch (kasus
 * NBH-20261017-5F860649E9), dan itu yang pekerjaan cron ini kurangi.
 *
 * Jalankan manual untuk tes:
 *   APP_DIR/deploy/systemd/nambah-cron-run.sh supplier-price-sync
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const report = await syncSupplierPrices();
    return Response.json(report);
  } catch (error) {
    console.error("Supplier price sync failed", error);
    return Response.json(
      { error: "Sinkron harga supplier gagal dijalankan." },
      { status: 502 },
    );
  }
}
