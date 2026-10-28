import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Daftar permintaan refund untuk seksi Refund di dashboard admin.
 *
 * BACA SAJA. Semua aksi (proses / konfirmasi selesai / tolak) tetap lewat
 * route lama `/api/admin/orders/[id]/refund` yang superadminOnly — tabel ini
 * hanya menjawab "permintaan apa saja yang sedang menunggu", sehingga admin
 * tidak harus menebak order mana yang dijumlah pelanggan satu per satu.
 *
 * Scope: operasional (peta di `admin-scope.ts`), sejajar dengan daftar
 * transaksi. Role admin bisa MELIHAT; tombol aksinya digerbang role di UI.
 */

type RefundRow = {
  id: number;
  order_id: string;
  provider: string;
  provider_refund_id: string | null;
  amount: string | number;
  reason: string;
  status: string;
  requested_by_admin_user_id: string | null;
  processed_by_admin_user_id: string | null;
  request_note: string | null;
  completed_note: string | null;
  provider_response: Record<string, unknown> | null;
  requested_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rows = await supabaseSelect<RefundRow>("refunds", {
      select: "id,order_id,provider,provider_refund_id,amount,reason,status,requested_by_admin_user_id,processed_by_admin_user_id,request_note,completed_note,provider_response,requested_at,processed_at,created_at,updated_at",
      order: "created_at.desc",
      limit: 100,
    });

    return Response.json({
      refunds: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        provider: row.provider,
        providerRefundId: row.provider_refund_id,
        amount: Number(row.amount || 0),
        reason: row.reason,
        status: row.status,
        requestedBy: row.requested_by_admin_user_id,
        processedBy: row.processed_by_admin_user_id,
        requestNote: row.request_note,
        completedNote: row.completed_note,
        providerResponse: row.provider_response,
        requestedAt: row.requested_at,
        processedAt: row.processed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("Admin refunds failed", error);
    return Response.json(
      { error: "Daftar refund gagal dimuat. Cek log server untuk detail." },
      { status: 502 },
    );
  }
}
