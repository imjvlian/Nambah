import type { Metadata } from "next";
import OrderStatusView from "@/components/OrderStatusView";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Status Pesanan — ${BRAND.name}`,
  description: `Lihat status dan ringkasan pesanan ${BRAND.shortName}.`,
};

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderStatusView orderId={id} />;
}
