import type { PublicOrderStatus } from "@/lib/order-public";
import { supabaseRpc } from "@/lib/supabase/server";

export async function reservePromotionForOrder(orderId: string) {
  return supabaseRpc<Record<string, unknown>>("nambah_promotion_reserve", {
    p_order_id: orderId,
  });
}

export async function syncPromotionLifecycle(
  orderId: string,
  status: PublicOrderStatus,
) {
  if (status === "paid" || status === "processing" || status === "success") {
    return supabaseRpc<Record<string, unknown>>("nambah_promotion_commit", {
      p_order_id: orderId,
    });
  }

  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "refunded"
  ) {
    return supabaseRpc<Record<string, unknown>>("nambah_promotion_release", {
      p_order_id: orderId,
    });
  }

  return null;
}
