import {
  getActivePaymentProvider,
  isPaymentProviderId,
  type PaymentProviderId,
} from "@/lib/payment-settings";
import type { MidtransStatusPayload } from "@/lib/midtrans/client";
import { createMidtransPaymentSession, fetchMidtransStatus } from "./midtrans";
import {
  createDokuCheckoutPayment,
  createDokuQrisPayment,
  fetchDokuCheckoutStatus,
  fetchDokuQrisStatus,
  getDokuMode,
  isDokuSnapConfigured,
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
 * app_settings. DOKU dual-mode: SNAP (QRIS inline native, butuh RSA keys)
 * diprioritaskan; kalau belum ada, jatuh ke Jokul Checkout (hosted page
 * semua channel) dengan kredensial Client-Id + Secret Key saja.
 */
export async function createPaymentSession(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const provider = await getActivePaymentProvider();

  if (provider === "doku") {
    const mode = getDokuMode();
    if (mode === "snap" && isQrisMethod(input)) {
      return createDokuQrisPayment(input);
    }
    if (mode) {
      return createDokuCheckoutPayment(input);
    }
    throw new Error(
      "Gateway DOKU belum terkonfigurasi (minimal DOKU_CLIENT_ID + DOKU_SECRET_KEY).",
    );
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
    // Order SNAP menyimpan referenceNo dari qr-mpm-generate; order Checkout
    // tidak. Kalau referenceNo ada DAN SNAP masih terkonfigurasi → query SNAP,
    // selain itu pakai check status non-SNAP (per invoice).
    if (options?.referenceNo && isDokuSnapConfigured()) {
      const doku = await fetchDokuQrisStatus({
        orderId,
        referenceNo: options.referenceNo,
      });
      return { provider: "doku", doku };
    }
    const doku = await fetchDokuCheckoutStatus(orderId);
    return { provider: "doku", doku };
  }

  return { provider: "midtrans", raw: await fetchMidtransStatus(orderId) };
}
