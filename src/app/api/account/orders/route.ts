import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type AccountOrderRow = {
  id: string;
  status: string;
  final_price: number | string;
  points_redeemed: number | string;
  points_discount: number | string;
  points_earned: number | string;
  created_at: string;
  updated_at: string;
  game: { name: string; short_name: string } | null;
  product: { label: string } | null;
};

export async function GET(request: Request) {
  try {
    const auth = await resolveNambahAuth(request);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
    });
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    const rows = await supabaseSelect<AccountOrderRow>("orders", {
      select:
        "id,status,final_price,points_redeemed,points_discount,points_earned,created_at,updated_at,game:games(name,short_name),product:products(label)",
      filters: {
        customer_user_id: `eq.${auth.user.id}`,
      },
      order: "created_at.desc",
      limit: 50,
    });

    return Response.json(
      {
        orders: rows.map((row) => ({
          id: row.id,
          status: row.status,
          finalPrice: Number(row.final_price),
          pointsRedeemed: Number(row.points_redeemed),
          pointsDiscount: Number(row.points_discount),
          pointsEarned: Number(row.points_earned),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          gameName: row.game?.name ?? row.game?.short_name ?? "Produk digital",
          packageLabel: row.product?.label ?? "-",
        })),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Account order history failed", error);
    return Response.json(
      { error: "Riwayat transaksi belum dapat dimuat." },
      { status: 503 },
    );
  }
}
