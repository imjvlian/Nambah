import {
  createMidtransSnapTransaction,
  getMidtransTransactionStatus,
  type MidtransStatusPayload,
} from "@/lib/midtrans/client";
import type { CreatePaymentInput, PaymentSession } from "./types";

/**
 * Membungkus client Midtrans yang sudah ada ke bentuk PaymentSession
 * ternormalisasi — perilaku identik dengan pemanggilan langsung.
 */
export async function createMidtransPaymentSession(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const snap = await createMidtransSnapTransaction({
    orderId: input.orderId,
    grossAmount: input.grossAmount,
    itemId: input.itemId,
    itemName: input.itemName,
    enabledPayments: input.enabledPayments,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
  });

  return {
    provider: "midtrans",
    payload: {
      kind: "snap",
      snapToken: snap.token,
      redirectUrl: snap.redirectUrl,
    },
  };
}

export async function fetchMidtransStatus(
  orderId: string,
): Promise<MidtransStatusPayload> {
  return getMidtransTransactionStatus(orderId);
}
