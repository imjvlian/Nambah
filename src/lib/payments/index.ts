import {
  getActivePaymentProvider,
  isPaymentProviderId,
  type PaymentProviderId,
} from "@/lib/payment-settings";
import type { MidtransStatusPayload } from "@/lib/midtrans/client";
import { createMidtransPaymentSession, fetchMidtransStatus } from "./midtrans";
import {
  createDokuQrisPayment,
  fetchDokuQrisStatus,
  type DokuStatusResult,
} from "./doku";
import type { CreatePaymentInput, PaymentSession } from "./types";

export function normalizeProviderId(value: unknown): PaymentProviderId {
  return isPaymentProviderId(value) ? value : "midtrans";
}

function isQrisMethod(input: CreatePaymentInput) {
  const method = input.paymentMethodId.toLowerCase();
  return method.includes("qris") || input.enabledPayments.some((p) => p.toLowerCase().includes("qris"));
}

/**
 * Membuat sesi pembayaran untuk ORDER BARU memakai gateway aktif dari
 * app_settings. DOKU tahap 3: QRIS native; channel lain menyusul.
 */
export async function createPaymentSession(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const provider = await getActivePaymentProvider();

  if (provider === "doku") {
    if (!isQrisMethod(input)) {
      throw new Error(
        "Gateway DOKU saat ini baru mendukung QRIS. Pilih QRIS, atau alihkan gateway ke Midtrans untuk metode lain.",
      );
    }
    return createDokuQrisPayment(input);
  }

  return createMidtransPaymentSession(input);
}

export type GatewayStatusResult =
  | { provider: "midtrans"; raw: MidtransStatusPayload }
  | { provider: "doku"; doku: DokuStatusResult };

/**
 * Mengambil status transaksi dari gateway PEMBUAT order — bukan gateway
 * aktif saat ini — supaya switch aman dilakukan kapan saja.
 */
export async function fetchGatewayStatus(
  provider: PaymentProviderId,
  orderId: string,
  options?: { referenceNo?: string | null },
): Promise<GatewayStatusResult> {
  if (provider === "doku") {
    const doku = await fetchDokuQrisStatus({
      orderId,
      referenceNo: options?.referenceNo ?? null,
    });
    return { provider: "doku", doku };
  }

  return { provider: "midtrans", raw: await fetchMidtransStatus(orderId) };
}
