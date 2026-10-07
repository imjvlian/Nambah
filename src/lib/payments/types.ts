import type { PaymentProviderId } from "@/lib/payment-settings";

/**
 * Sesi pembayaran yang dinormalisasi lintas gateway. `raw` menyimpan respons
 * asli provider untuk disimpan di orders.payment_payload (audit & rekonsiliasi).
 */
export type PaymentSessionPayload = {
  kind: "snap" | "qris" | "va" | "ewallet" | "card" | "retail";
  snapToken?: string;
  /** Snap redirect / deeplink e-wallet / halaman 3DS kartu. */
  redirectUrl?: string;
  /** Konten QRIS untuk dirender inline di halaman order. */
  qrContent?: string;
  vaNumber?: string;
  bankCode?: string;
  /** Kode bayar gerai retail (Alfamart/Indomaret). */
  paymentCode?: string;
  expiresAt?: string | null;
  raw?: unknown;
};

export type PaymentSession = {
  provider: PaymentProviderId;
  payload: PaymentSessionPayload;
};

export type CreatePaymentInput = {
  orderId: string;
  grossAmount: number;
  itemId: string;
  itemName: string;
  paymentMethodId: string;
  /** Daftar channel gaya Midtrans — dipakai Snap; DOKU memetakan dari sini. */
  enabledPayments: string[];
  customerEmail?: string;
  customerPhone?: string;
};
