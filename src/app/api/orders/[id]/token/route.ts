import { NextResponse } from "next/server";
import { getPublicOrder } from "@/lib/order-service";
import { signOrderAccess } from "@/lib/order-access";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return NextResponse.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  try {
    const order = await getPublicOrder(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ token: signOrderAccess(orderId) });
  } catch (error) {
    console.error("Order token generation failed", error);
    return NextResponse.json(
      { error: "Gagal membuat token akses." },
      { status: 500 },
    );
  }
}