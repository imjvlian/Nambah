import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type AdminOrderRow = {
  id: string;
  status: string;
  final_price: number | string;
  target_user_id: string;
  target_server_id: string | null;
  receipt_email: string | null;
  customer_user_id: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  game: { name: string; short_name: string } | null;
  product: { label: string } | null;
  payment: { name: string } | null;
};

function maskEmail(value: string | null) {
  if (!value) return null;
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rows = await supabaseSelect<AdminOrderRow>("orders", {
      select:
        "id,status,final_price,target_user_id,target_server_id,receipt_email,customer_user_id,created_at,updated_at,paid_at,fulfilled_at,game:games(name,short_name),product:products(label),payment:payment_methods(name)",
      order: "created_at.desc",
      limit: 100,
    });

    return Response.json({
      orders: rows.map((row) => ({
        id: row.id,
        status: row.status,
        finalPrice: Number(row.final_price),
        targetUserId: row.target_user_id,
        targetServerId: row.target_server_id,
        receiptEmail: maskEmail(row.receipt_email),
        customerUserId: row.customer_user_id,
        gameName: row.game?.name ?? row.game?.short_name ?? "Produk digital",
        packageLabel: row.product?.label ?? "-",
        paymentName: row.payment?.name ?? "-",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        paidAt: row.paid_at,
        fulfilledAt: row.fulfilled_at,
      })),
    });
  } catch (error) {
    console.error("Admin orders failed", error);
    return Response.json(
      { error: "Daftar order admin tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
