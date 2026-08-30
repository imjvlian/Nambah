import type { Metadata } from "next";
import OrderStatusView from "@/components/OrderStatusView";

export const metadata: Metadata = {
  title: "Status Pesanan — Nambah",
  description: "Lihat status dan ringkasan pesanan Nambah.",
};

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderStatusView orderId={id} />;
}
