export type NambahOrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "success"
  | "failed"
  | "refunded"
  | "cancelled";

export type NormalizedPaymentStatus =
  | "pending"
  | "settlement"
  | "capture"
  | "deny"
  | "cancel"
  | "expire"
  | "refund"
  | "failure";

export function normalizePaymentStatus(status: string | undefined): NormalizedPaymentStatus {
  switch (status) {
    case "settlement":
    case "capture":
    case "deny":
    case "cancel":
    case "expire":
    case "refund":
    case "failure":
      return status;
    case "partial_refund":
      return "refund";
    default:
      return "pending";
  }
}

export function nextOrderStatusFromPayment(
  current: NambahOrderStatus,
  input: { transactionStatus?: string; fraudStatus?: string | null },
): NambahOrderStatus {
  const status = input.transactionStatus ?? "pending";
  const fraudStatus = input.fraudStatus?.toLowerCase();

  if (status === "refund" || status === "partial_refund") return "refunded";
  if (current === "refunded") return current;

  const paid =
    status === "settlement" ||
    (status === "capture" && (!fraudStatus || fraudStatus === "accept"));

  if (paid) {
    if (current === "processing" || current === "success") return current;
    return "paid";
  }

  if (current === "paid" || current === "processing" || current === "success") {
    return current;
  }

  if (status === "expire" || status === "cancel") return "cancelled";
  if (status === "failure") return "failed";

  return "pending_payment";
}
