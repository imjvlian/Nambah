import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { checkAllSupplierBalances } from "@/lib/supplier-balance";

export const runtime = "nodejs";

/**
 * POST /api/admin/supplier-balance - cek saldo semua supplier.
 *
 * Route lama `/api/admin/digiflazz/balance` tetap ada dan tidak berubah
 * bentuk jawabannya, karena tombol "Cek saldo" di dashboard masih
 * memakainya untuk Digiflazz. Route ini menutup supplier yang lain -
 * tanpa kredensial Melostore, tidak ada cara memperbarui saldo yang
 * sedang jadi sumber modal order Melostore.
 *
 * Supplier yang belum dikonfigurasi dikembalikan sebagai `ok: false`
 * beserta alasannya, bukan menggagalkan seluruh pemeriksaan: satu akun
 * yang belum diisi tidak boleh membuat saldo supplier lain berhenti
 * diperbarui.
 */
export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let notify = false;
  try {
    const raw = await request.text();
    if (raw) {
      const body = JSON.parse(raw) as { notify?: boolean };
      notify = body.notify === true;
    }
  } catch {
    return Response.json(
      { error: "Request cek saldo tidak valid." },
      { status: 400 },
    );
  }

  try {
    const result = await checkAllSupplierBalances({ source: "manual", notify });

    await auditAdminAction(request, {
      action: "supplier.balance_check",
      targetType: "supplier_balance",
      targetId: "all",
      metadata: {
        notify,
        checked: result.checked,
        ok: result.results.filter((item) => item.ok).length,
        failed: result.results.filter((item) => !item.ok).length,
      },
    });

    return Response.json(result);
  } catch (error) {
    console.error("Supplier balance check failed", error);
    return Response.json(
      { error: "Cek saldo supplier gagal dijalankan." },
      { status: 502 },
    );
  }
}
