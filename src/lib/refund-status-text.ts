import { formatIDR } from "@/lib/pricing";

export type RefundStatusTextRow = {
  amount: number | string;
  reason: string;
  status: "requested" | "processing" | "completed" | "failed" | "rejected";
  completed_note?: string | null;
};

export function refundStatusText(refund: RefundStatusTextRow) {
  const amount = formatIDR(Number(refund.amount));

  if (refund.status === "completed") {
    return `Refund ${amount} sudah selesai.`;
  }
  if (refund.status === "processing") {
    return `Refund ${amount} sedang diproses.`;
  }
  if (refund.status === "failed") {
    return `Refund gagal diproses. ${refund.reason}`;
  }
  if (refund.status === "rejected") {
    return `Refund ditolak. ${refund.completed_note ?? refund.reason}`;
  }
  return `Refund ${amount} sedang menunggu diproses.`;
}
