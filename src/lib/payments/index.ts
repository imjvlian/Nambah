import {
  getActivePaymentProvider,
  isPaymentProviderId,
  type PaymentProviderId,
} from "@/lib/payment-settings";
import type { MidtransStatusPayload } from "@/lib/midtrans/client";
import { createMidtransPaymentSession, fetchMidtransStatus } from "./midtrans";
import type { CreatePaymentInput, PaymentSession } from "./types";

export function normalizeProviderId(value: unknown): PaymentProviderId {
  return isPaymentProviderId(value) ? value : "midtrans";
}

/**
 * Membuat sesi pembayaran untuk ORDER BARU memakai gateway aktif dari
 * app_settings. Integrasi DOKU menyusul (tahap 3) — selama env DOKU belum
 * terisi, switch terkunci di dashboard sehingga cabang ini tidak tercapai.
 */
export async function createPaymentSession(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const provider = await getActivePaymentProvider();

  if (provider === "doku") {
    throw new Error("Gateway DOKU belum tersedia. Alihkan kembali ke Midtrans.");
  }

  return createMidtransPaymentSession(input);
}

/**
 * Mengambil status transaksi dari gateway PEMBUAT order — bukan gateway
 * aktif saat ini — supaya switch aman dilakukan kapan saja.
 */
export async function fetchGatewayStatus(
  provider: PaymentProviderId,
  orderId: string,
): Promise<{ provider: PaymentProviderId; raw: MidtransStatusPayload }> {
  if (provider === "doku") {
    throw new Error("Status DOKU belum tersedia (integrasi tahap 3).");
  }

  return { provider: "midtrans", raw: await fetchMidtransStatus(orderId) };
}
