import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  whatsapp: string | null;
  preferred_receipt_channel: string;
  created_at: string;
  updated_at: string;
};

type OrderRow = {
  customer_user_id: string | null;
  final_price: number | string;
  status: string;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const [profiles, orders] = await Promise.all([
      supabaseSelect<ProfileRow>("customer_profiles", {
        select:
          "user_id,display_name,whatsapp,preferred_receipt_channel,created_at,updated_at",
        order: "updated_at.desc",
        limit: 1000,
      }).catch(() => []),
      supabaseSelect<OrderRow>("orders", {
        select: "customer_user_id,final_price,status,created_at",
        order: "created_at.desc",
        limit: 5000,
      }),
    ]);

    const stats = new Map<
      string,
      { orders: number; success: number; spend: number; lastOrderAt: string | null }
    >();

    for (const order of orders) {
      if (!order.customer_user_id) continue;
      const current = stats.get(order.customer_user_id) ?? {
        orders: 0,
        success: 0,
        spend: 0,
        lastOrderAt: null,
      };
      current.orders += 1;
      if (order.status === "success") {
        current.success += 1;
        current.spend += Number(order.final_price);
      }
      if (!current.lastOrderAt) current.lastOrderAt = order.created_at;
      stats.set(order.customer_user_id, current);
    }

    const ids = new Set([
      ...profiles.map((row) => row.user_id),
      ...Array.from(stats.keys()),
    ]);

    return Response.json({
      users: Array.from(ids).map((userId) => {
        const profile = profiles.find((row) => row.user_id === userId);
        const summary = stats.get(userId) ?? {
          orders: 0,
          success: 0,
          spend: 0,
          lastOrderAt: null,
        };
        return {
          userId,
          displayName: profile?.display_name ?? null,
          whatsapp: profile?.whatsapp ?? null,
          preferredReceiptChannel:
            profile?.preferred_receipt_channel ?? "email",
          profileUpdatedAt: profile?.updated_at ?? null,
          ...summary,
        };
      }),
    });
  } catch (error) {
    console.error("Admin user lookup failed", error);
    return Response.json(
      { error: "Data user tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
