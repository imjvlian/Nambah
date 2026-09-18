import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  try {
    const [orders, payments, supplier, receipts, commissions, points, promo] =
      await Promise.all([
        supabaseSelect<Record<string, unknown>>("orders", {
          select:
            "id,status,customer_user_id,receipt_email,receipt_whatsapp,target_user_id,target_server_id,reference_price,selling_price,supplier_cost,customer_payment_fee,merchant_payment_cost,promotion_discount,referral_discount,points_redeemed,points_discount,points_earned,final_price,net_profit_before_affiliate,affiliate_rate,affiliate_commission,nambah_profit,paid_at,fulfilled_at,created_at,updated_at,game:games(name,short_name),product:products(label),payment_method:payment_methods(name)",
          filters: { id: "eq." + orderId },
          limit: 1,
        }),
        supabaseSelect<Record<string, unknown>>("payments", {
          select:
            "id,provider,provider_transaction_id,status,amount,raw_status,payment_type,fraud_status,paid_at,created_at,updated_at",
          filters: { order_id: "eq." + orderId },
          order: "created_at.desc",
          limit: 10,
        }),
        supabaseSelect<Record<string, unknown>>("supplier_transactions", {
          select:
            "id,supplier_id,request_ref,supplier_transaction_id,supplier_sku,target,cost,status,message,serial_number,created_at,updated_at",
          filters: { order_id: "eq." + orderId },
          order: "created_at.desc",
          limit: 10,
        }),
        supabaseSelect<Record<string, unknown>>("receipt_deliveries", {
          select:
            "id,channel,recipient,provider,status,provider_message_id,attempts,last_error,sent_at,created_at,updated_at",
          filters: { order_id: "eq." + orderId },
          order: "created_at.desc",
          limit: 10,
        }),
        supabaseSelect<Record<string, unknown>>("commissions", {
          select:
            "id,affiliate_code,base_profit,rate,amount,status,available_at,created_at,updated_at",
          filters: { order_id: "eq." + orderId },
          limit: 5,
        }).catch(() => []),
        supabaseSelect<Record<string, unknown>>("point_ledger", {
          select:
            "id,type,points_delta,reserved_delta,balance_after,reserved_after,note,created_at",
          filters: { order_id: "eq." + orderId },
          order: "created_at.desc",
          limit: 20,
        }).catch(() => []),
        supabaseSelect<Record<string, unknown>>("promotion_redemptions", {
          select:
            "id,promotion_code,status,reserved_at,redeemed_at,released_at,updated_at",
          filters: { order_id: "eq." + orderId },
          limit: 5,
        }).catch(() => []),
      ]);

    if (!orders[0]) {
      return Response.json({ error: "Order tidak ditemukan." }, { status: 404 });
    }

    return Response.json({
      order: orders[0],
      payments,
      supplierTransactions: supplier,
      receipts,
      commissions,
      points,
      promotionRedemptions: promo,
    });
  } catch (error) {
    console.error("Admin order detail failed", error);
    return Response.json(
      { error: "Detail order tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
