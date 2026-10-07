import { isMidtransConfigured, getMidtransEnvironment } from "@/lib/midtrans/client";
import {
  isSupabaseConfigured,
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase/server";

export type PaymentProviderId = "midtrans" | "doku";

export const PAYMENT_PROVIDERS: PaymentProviderId[] = ["midtrans", "doku"];

const ACTIVE_PROVIDER_KEY = "active_payment_provider";
const DEFAULT_PROVIDER: PaymentProviderId = "midtrans";

type AppSettingRow = {
  key: string;
  value: unknown;
  updated_at: string;
};

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return value === "midtrans" || value === "doku";
}

/**
 * Provider untuk ORDER BARU. Fallback ke 'midtrans' kalau tabel app_settings
 * belum ada / error — supaya perilaku existing tidak berubah sebelum migrasi
 * 025 dijalankan.
 */
export async function getActivePaymentProvider(): Promise<PaymentProviderId> {
  if (!isSupabaseConfigured()) return DEFAULT_PROVIDER;
  try {
    const rows = await supabaseSelect<AppSettingRow>("app_settings", {
      select: "key,value,updated_at",
      filters: { key: `eq.${ACTIVE_PROVIDER_KEY}` },
      limit: 1,
    });
    const value = rows[0]?.value;
    return isPaymentProviderId(value) ? value : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

export async function setActivePaymentProvider(provider: PaymentProviderId) {
  await supabaseUpsert<AppSettingRow>(
    "app_settings",
    {
      key: ACTIVE_PROVIDER_KEY,
      value: provider,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

export function isDokuConfigured() {
  // SNAP butuh 5 kredensial: client id, secret (HMAC), private key RSA
  // (token B2B), merchant id, dan terminal id (QRIS).
  return Boolean(
    process.env.DOKU_CLIENT_ID?.trim() &&
      process.env.DOKU_SECRET_KEY?.trim() &&
      process.env.DOKU_PRIVATE_KEY?.trim() &&
      process.env.DOKU_MERCHANT_ID?.trim() &&
      process.env.DOKU_TERMINAL_ID?.trim(),
  );
}

export function getDokuEnvironment(): "sandbox" | "production" {
  return process.env.DOKU_ENV?.trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

export type PaymentProviderStatus = {
  id: PaymentProviderId;
  name: string;
  configured: boolean;
  environment: "sandbox" | "production" | null;
  note: string;
};

export function getPaymentProviderStatuses(): PaymentProviderStatus[] {
  return [
    {
      id: "midtrans",
      name: "Midtrans",
      configured: isMidtransConfigured(),
      environment: isMidtransConfigured() ? getMidtransEnvironment() : null,
      note: isMidtransConfigured()
        ? "Snap embed + webhook aktif"
        : "MIDTRANS_SERVER_KEY belum diisi",
    },
    {
      id: "doku",
      name: "DOKU",
      configured: isDokuConfigured(),
      environment: isDokuConfigured() ? getDokuEnvironment() : null,
      note: isDokuConfigured()
        ? "Jokul SNAP direct API siap (QRIS native)"
        : "DOKU_CLIENT_ID / SECRET_KEY / PRIVATE_KEY / MERCHANT_ID / TERMINAL_ID belum lengkap",
    },
  ];
}
